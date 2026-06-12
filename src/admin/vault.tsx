import { Hono } from 'hono'
import { db } from '../db/client'
import { setKey } from '../vault'
import { initOAuthFlow, completeOAuthFlow, hasPendingOAuthFlow, getPendingAuthUrl, cancelOAuthFlow } from '../vault/openai_oauth'
import { Layout } from './components/Layout'
import { renderPage, renderFragment } from './render'

const KNOWN_PROVIDERS = ['anthropic', 'openai', 'google'] as const
type Provider = (typeof KNOWN_PROVIDERS)[number]

interface VaultMetaRow {
  provider: string
  updated_at: number
}

function fmtDate(unix: number): string {
  return new Date(unix * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

interface VaultCardProps {
  provider: Provider
  row: VaultMetaRow | undefined
}

function VaultCard({ provider, row }: VaultCardProps) {
  const statusId = `vault-status-${provider}`
  return (
    <div className="vault-card">
      <div className="vault-head">
        <h3>{provider}</h3>
        <div className="vault-status">
          {row ? (
            <>
              <span className="status-ok">Set</span>
              {' · rotated '}
              {fmtDate(row.updated_at)}
            </>
          ) : (
            <span className="status-warn">Not set</span>
          )}
        </div>
      </div>
      <form
        hx-post={`/admin/vault/${provider}`}
        hx-target={`#${statusId}`}
        hx-swap="innerHTML"
        autoComplete="off"
      >
        <label htmlFor={`key-${provider}`} className="muted">
          New API key (replaces existing)
        </label>
        <input
          id={`key-${provider}`}
          type="password"
          name="key"
          placeholder={`${provider} API key`}
          required
        />
        <div className="actions">
          <button type="submit" className="btn-primary">Save key</button>
          {row && (
            <button
              type="button"
              className="btn-danger"
              hx-post={`/admin/vault/${provider}/delete`}
              hx-target={`#${statusId}`}
              hx-confirm={`Delete the ${provider} API key?`}
            >
              Delete
            </button>
          )}
          <span id={statusId} className="status" />
        </div>
      </form>
    </div>
  )
}

interface ChatGPTOAuthCardProps {
  hasPending: boolean
  authUrl?: string
}

function ChatGPTOAuthCard({ hasPending, authUrl }: ChatGPTOAuthCardProps) {
  return (
    <div className="vault-card" id="chatgpt-oauth-card">
      <div className="vault-head">
        <h3>openai (ChatGPT subscription)</h3>
        <div className="vault-status">
          <span className="status-warn">OAuth flow</span>
        </div>
      </div>
      <p className="muted" style={{ marginBottom: '0.75rem' }}>
        Use your ChatGPT Plus/Pro subscription instead of a paid API key.
        This uses OpenAI's Codex OAuth — no per-token billing.
      </p>
      {!hasPending && !authUrl ? (
        <div className="actions">
          <button
            type="button"
            className="btn-primary"
            hx-post="/admin/vault/openai-chatgpt/init"
            hx-target="#chatgpt-oauth-card"
            hx-swap="outerHTML"
          >
            Connect ChatGPT
          </button>
        </div>
      ) : (
        <div>
          <p className="muted">
            <strong>Step 1:</strong> Open this URL in your browser and authorize access:
          </p>
          <div style={{ wordBreak: 'break-all', background: 'var(--bg-2, #f5f5f5)', padding: '0.5rem', borderRadius: '4px', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
            <a href={authUrl} target="_blank" rel="noopener noreferrer">{authUrl}</a>
          </div>
          <p className="muted">
            <strong>Step 2:</strong> After authorizing, your browser will redirect to{' '}
            <code>localhost:1455</code> (which will show an error — that&apos;s expected).
            Copy the full URL from your browser&apos;s address bar and paste it below:
          </p>
          <form
            hx-post="/admin/vault/openai-chatgpt/callback"
            hx-target="#chatgpt-oauth-card"
            hx-swap="outerHTML"
            autoComplete="off"
          >
            <label htmlFor="callback-url" className="muted">Callback URL (contains <code>?code=…</code>)</label>
            <textarea
              id="callback-url"
              name="callbackUrl"
              rows={3}
              placeholder="http://localhost:1455/auth/callback?code=...&state=..."
              required
              style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical' }}
            />
            <div className="actions" style={{ marginTop: '0.5rem' }}>
              <button type="submit" className="btn-primary">Complete Connection</button>
              <button
                type="button"
                className="btn-danger"
                hx-post="/admin/vault/openai-chatgpt/cancel"
                hx-target="#chatgpt-oauth-card"
                hx-swap="outerHTML"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

interface VaultPageProps {
  csrfToken: string
  byProvider: Map<string, VaultMetaRow>
  hasPendingOAuth: boolean
  pendingAuthUrl?: string
}

function VaultPage({ csrfToken, byProvider, hasPendingOAuth, pendingAuthUrl }: VaultPageProps) {
  return (
    <Layout title="Vault" csrfToken={csrfToken} currentPath="/admin/vault">
      <h2>BYOK vault</h2>
      <p className="muted">
        Provider API keys are AES-GCM encrypted at rest with <code>VAULT_PASSPHRASE</code>.
        This page never displays stored keys — only set/rotate/delete.
      </p>
      <div className="vault-grid">
        {KNOWN_PROVIDERS.map((p) => (
          <VaultCard key={p} provider={p} row={byProvider.get(p)} />
        ))}
        <ChatGPTOAuthCard hasPending={hasPendingOAuth} authUrl={pendingAuthUrl} />
      </div>
    </Layout>
  )
}

export const vaultRoutes = new Hono()

vaultRoutes.get('/', (c) => {
  const csrfToken = c.get('csrf_token') as string
  const rows = db.query('SELECT provider, updated_at FROM vault_keys').all() as VaultMetaRow[]
  const byProvider = new Map(rows.map((r) => [r.provider, r]))
  const hasPendingOAuth = hasPendingOAuthFlow()
  return c.html(renderPage(<VaultPage csrfToken={csrfToken} byProvider={byProvider} hasPendingOAuth={hasPendingOAuth} pendingAuthUrl={hasPendingOAuth ? getPendingAuthUrl() : undefined} />))
})

vaultRoutes.post('/openai-chatgpt/init', async (c) => {
  try {
    const authUrl = await initOAuthFlow()
    return c.html(renderFragment(<ChatGPTOAuthCard hasPending={true} authUrl={authUrl} />))
  } catch (err) {
    return c.html(renderFragment(
      <div className="vault-card" id="chatgpt-oauth-card">
        <span className="status-err">Failed to start OAuth: {String(err)}</span>
      </div>
    ), 500)
  }
})

vaultRoutes.post('/openai-chatgpt/callback', async (c) => {
  const form = await c.req.formData()
  const callbackUrl = String(form.get('callbackUrl') ?? '').trim()
  if (!callbackUrl) {
    return c.html(renderFragment(
      <div className="vault-card" id="chatgpt-oauth-card">
        <span className="status-err">No callback URL provided.</span>
      </div>
    ), 400)
  }
  try {
    await completeOAuthFlow(callbackUrl)
    return c.html(renderFragment(
      <div className="vault-card" id="chatgpt-oauth-card">
        <div className="vault-head">
          <h3>openai (ChatGPT subscription)</h3>
          <div className="vault-status"><span className="status-ok">Connected</span></div>
        </div>
        <p className="muted">Access token and refresh token saved. Re-connect when the access token expires.</p>
        <div className="actions">
          <button
            type="button"
            className="btn-primary"
            hx-post="/admin/vault/openai-chatgpt/init"
            hx-target="#chatgpt-oauth-card"
            hx-swap="outerHTML"
          >
            Re-connect
          </button>
        </div>
      </div>
    ))
  } catch (err) {
    return c.html(renderFragment(
      <div className="vault-card" id="chatgpt-oauth-card">
        <div className="vault-head">
          <h3>openai (ChatGPT subscription)</h3>
        </div>
        <span className="status-err">{String(err)}</span>
        <div className="actions" style={{ marginTop: '0.75rem' }}>
          <button
            type="button"
            className="btn-primary"
            hx-post="/admin/vault/openai-chatgpt/init"
            hx-target="#chatgpt-oauth-card"
            hx-swap="outerHTML"
          >
            Try again
          </button>
        </div>
      </div>
    ), 400)
  }
})

vaultRoutes.post('/openai-chatgpt/cancel', (c) => {
  cancelOAuthFlow()
  return c.html(renderFragment(<ChatGPTOAuthCard hasPending={false} />))
})

vaultRoutes.post('/:provider', async (c) => {
  const provider = c.req.param('provider')
  if (!KNOWN_PROVIDERS.includes(provider as Provider)) {
    return c.html(renderFragment(<span className="status-err">Unknown provider.</span>), 400)
  }
  const form = await c.req.formData()
  const key = String(form.get('key') ?? '').trim()
  if (!key) return c.html(renderFragment(<span className="status-err">Empty key.</span>), 400)
  try {
    await setKey(provider, key)
    return c.html(renderFragment(<span className="status-ok">Saved.</span>))
  } catch (err) {
    return c.html(renderFragment(<span className="status-err">{`Failed: ${String(err)}`}</span>), 500)
  }
})

vaultRoutes.post('/:provider/delete', (c) => {
  const provider = c.req.param('provider')
  if (!KNOWN_PROVIDERS.includes(provider as Provider)) {
    return c.html(renderFragment(<span className="status-err">Unknown provider.</span>), 400)
  }
  db.run('DELETE FROM vault_keys WHERE provider = ?', [provider])
  return c.html(renderFragment(<span className="status-ok">Deleted.</span>))
})
