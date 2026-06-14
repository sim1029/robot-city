const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'

export class GoogleAuthExpiredError extends Error {
  constructor() {
    super('Google authentication has expired. Please re-authenticate.')
    this.name = 'GoogleAuthExpiredError'
  }
}

export function getReauthUrl(): string {
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? ''
  return redirectUri.replace(/\/callback$/, '')
}

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/contacts.readonly',
]

export interface GmailTokens {
  access_token: string
  refresh_token: string
  expires_in: number
  scope: string
  token_type: string
}

export interface GmailRefreshResult {
  access_token: string
  expires_in: number
  scope: string
  token_type: string
}

export function getGmailAuthUrl(state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const redirectUri = process.env.GOOGLE_REDIRECT_URI
  if (!clientId || !redirectUri) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_REDIRECT_URI must be set')
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${GOOGLE_AUTH}?${params}`
}

export async function exchangeGmailCode(code: string): Promise<GmailTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: requireEnv('GOOGLE_CLIENT_ID'),
    client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
    redirect_uri: requireEnv('GOOGLE_REDIRECT_URI'),
  })
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) throw new Error(`Google token exchange failed ${res.status}: ${await res.text()}`)
  return res.json() as Promise<GmailTokens>
}

export async function refreshGmailAccessToken(refreshToken: string): Promise<GmailRefreshResult> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: requireEnv('GOOGLE_CLIENT_ID'),
    client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
  })
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    const text = await res.text()
    if (text.includes('invalid_grant')) throw new GoogleAuthExpiredError()
    throw new Error(`Google token refresh failed ${res.status}: ${text}`)
  }
  return res.json() as Promise<GmailRefreshResult>
}

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} must be set`)
  return v
}
