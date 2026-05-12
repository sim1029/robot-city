import { Hono } from 'hono'
import { db } from '../db/client'
import { setKey } from '../vault'
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

interface VaultPageProps {
  csrfToken: string
  byProvider: Map<string, VaultMetaRow>
}

function VaultPage({ csrfToken, byProvider }: VaultPageProps) {
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
      </div>
    </Layout>
  )
}

export const vaultRoutes = new Hono()

vaultRoutes.get('/', (c) => {
  const csrfToken = c.get('csrf_token') as string
  const rows = db.query('SELECT provider, updated_at FROM vault_keys').all() as VaultMetaRow[]
  const byProvider = new Map(rows.map((r) => [r.provider, r]))
  return c.html(renderPage(<VaultPage csrfToken={csrfToken} byProvider={byProvider} />))
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
