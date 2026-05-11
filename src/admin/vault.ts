import { Hono } from 'hono'
import { db } from '../db/client'
import { setKey } from '../vault'
import { layout, esc } from './layout'

const KNOWN_PROVIDERS = ['anthropic', 'openai', 'google'] as const

interface VaultMetaRow {
  provider: string
  updated_at: number
}

function fmtDate(unix: number): string {
  return new Date(unix * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

export const vaultRoutes = new Hono()

vaultRoutes.get('/', (c) => {
  const csrfToken = c.get('csrf_token') as string
  const rows = db.query('SELECT provider, updated_at FROM vault_keys').all() as VaultMetaRow[]
  const byProvider = new Map(rows.map((r) => [r.provider, r]))

  const cards = KNOWN_PROVIDERS.map((p) => {
    const row = byProvider.get(p)
    const status = row
      ? `<span class="status-ok">Set</span> · rotated ${esc(fmtDate(row.updated_at))}`
      : `<span class="status-warn">Not set</span>`
    return `
      <div class="vault-card">
        <div class="vault-head">
          <h3>${esc(p)}</h3>
          <div class="vault-status">${status}</div>
        </div>
        <form hx-post="/admin/vault/${esc(p)}" hx-target="#vault-status-${esc(p)}" hx-swap="innerHTML" autocomplete="off">
          <label for="key-${esc(p)}" class="muted">New API key (replaces existing)</label>
          <input id="key-${esc(p)}" type="password" name="key" placeholder="${esc(p)} API key" required>
          <div class="actions">
            <button type="submit" class="btn-primary">Save key</button>
            ${row ? `<button type="button" class="btn-danger" hx-post="/admin/vault/${esc(p)}/delete" hx-target="#vault-status-${esc(p)}" hx-confirm="Delete the ${esc(p)} API key?">Delete</button>` : ''}
            <span id="vault-status-${esc(p)}" class="status"></span>
          </div>
        </form>
      </div>
    `
  }).join('')

  const body = `
    <h2>BYOK vault</h2>
    <p class="muted">Provider API keys are AES-GCM encrypted at rest with <code>VAULT_PASSPHRASE</code>. This page never displays stored keys — only set/rotate/delete.</p>
    <div class="vault-grid">${cards}</div>
  `

  return c.html(layout({ title: 'Vault', csrfToken, body, currentPath: '/admin/vault' }))
})

vaultRoutes.post('/:provider', async (c) => {
  const provider = c.req.param('provider')
  if (!KNOWN_PROVIDERS.includes(provider as typeof KNOWN_PROVIDERS[number])) {
    return c.html(`<span class="status-err">Unknown provider.</span>`, 400)
  }
  const form = await c.req.formData()
  const key = String(form.get('key') ?? '').trim()
  if (!key) return c.html(`<span class="status-err">Empty key.</span>`, 400)
  try {
    await setKey(provider, key)
    return c.html(`<span class="status-ok">Saved.</span>`)
  } catch (err) {
    return c.html(`<span class="status-err">Failed: ${esc(String(err))}</span>`, 500)
  }
})

vaultRoutes.post('/:provider/delete', (c) => {
  const provider = c.req.param('provider')
  if (!KNOWN_PROVIDERS.includes(provider as typeof KNOWN_PROVIDERS[number])) {
    return c.html(`<span class="status-err">Unknown provider.</span>`, 400)
  }
  db.run('DELETE FROM vault_keys WHERE provider = ?', [provider])
  return c.html(`<span class="status-ok">Deleted.</span>`)
})
