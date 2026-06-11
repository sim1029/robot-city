import { setKey } from './index'
import { getSetting, setSetting } from '../db/settings'

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const ISSUER = 'https://auth.openai.com'
const REDIRECT_URI = 'http://localhost:1455/auth/callback'
const SCOPES = 'openid profile email offline_access api.connectors.read api.connectors.invoke'
const STATE_SETTING_KEY = 'openai_oauth_pending'
const STATE_TTL_MS = 10 * 60 * 1000

interface OAuthState {
  state: string
  codeVerifier: string
  expiresAt: number
}

function base64url(buf: ArrayBuffer | Uint8Array): string {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return Buffer.from(arr)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

async function generatePkce(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(64))
  const codeVerifier = base64url(bytes)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
  const codeChallenge = base64url(digest)
  return { codeVerifier, codeChallenge }
}

export async function initOAuthFlow(): Promise<string> {
  const { codeVerifier, codeChallenge } = await generatePkce()
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)))

  const pending: OAuthState = { state, codeVerifier, expiresAt: Date.now() + STATE_TTL_MS }
  setSetting(STATE_SETTING_KEY, JSON.stringify(pending))

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state,
  })

  return `${ISSUER}/oauth/authorize?${params.toString()}`
}

function extractQueryParams(input: string): URLSearchParams {
  const trimmed = input.trim()
  try {
    return new URL(trimmed).searchParams
  } catch {
    try {
      const withBase = trimmed.startsWith('/') ? `http://x${trimmed}` : `http://x/${trimmed}`
      return new URL(withBase).searchParams
    } catch {
      return new URLSearchParams(trimmed.startsWith('?') ? trimmed.slice(1) : trimmed)
    }
  }
}

export async function completeOAuthFlow(callbackUrl: string): Promise<void> {
  const pendingRaw = getSetting(STATE_SETTING_KEY, '')
  if (!pendingRaw) throw new Error('No pending OAuth flow. Please start over.')

  const pending: OAuthState = JSON.parse(pendingRaw)
  if (Date.now() > pending.expiresAt) throw new Error('OAuth flow expired (10 min). Please start over.')

  const params = extractQueryParams(callbackUrl)
  const code = params.get('code')
  const returnedState = params.get('state')

  if (!code) throw new Error('No authorization code found in the pasted URL.')
  if (returnedState !== pending.state) throw new Error('State mismatch — possible CSRF. Please start over.')

  // Exchange authorization code for tokens
  const tokenResp = await fetch(`${ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: pending.codeVerifier,
    }).toString(),
  })

  if (!tokenResp.ok) {
    const text = await tokenResp.text()
    throw new Error(`Token exchange failed (${tokenResp.status}): ${text.slice(0, 200)}`)
  }

  const { id_token } = (await tokenResp.json()) as { id_token: string }
  if (!id_token) throw new Error('Token exchange response missing id_token.')

  // Exchange id_token for an OpenAI API key (Codex subscription key)
  const keyResp = await fetch(`${ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      client_id: CLIENT_ID,
      requested_token: 'openai-api-key',
      subject_token: id_token,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    }).toString(),
  })

  if (!keyResp.ok) {
    const text = await keyResp.text()
    if (text.includes('token_exchange_user_error')) {
      throw new Error(
        'This ChatGPT account does not have Codex access. ' +
        'ChatGPT Plus ($20/mo) does not include Codex CLI — ChatGPT Pro ($200/mo) is required.'
      )
    }
    throw new Error(`API key exchange failed (${keyResp.status}): ${text.slice(0, 200)}`)
  }

  const { access_token: apiKey } = (await keyResp.json()) as { access_token: string }
  if (!apiKey) throw new Error('API key exchange response missing access_token.')

  await setKey('openai', apiKey)
  setSetting(STATE_SETTING_KEY, '')
}

export function hasPendingOAuthFlow(): boolean {
  const raw = getSetting(STATE_SETTING_KEY, '')
  if (!raw) return false
  try {
    const pending: OAuthState = JSON.parse(raw)
    return Date.now() < pending.expiresAt
  } catch {
    return false
  }
}

export function cancelOAuthFlow(): void {
  setSetting(STATE_SETTING_KEY, '')
}
