import { Hono } from 'hono'
import { Layout } from './components/Layout'
import { renderPage, renderFragment } from './render'
import { listContacts, searchContacts, deleteContact } from '../contacts/client'
import { syncGoogleContacts } from '../contacts/sync'
import { getValidGmailAccessToken } from '../gmail/tokens'
import type { Contact } from '../contacts/client'

const PAGE_SIZE = 50
const COL_COUNT = 5

function fmtSource(source: string): string {
  if (source === 'google_contacts') return 'Google'
  if (source === 'manual') return 'Manual'
  return 'Email'
}

function fmtAgo(unix: number | null): string {
  if (!unix) return '—'
  const diff = Math.floor(Date.now() / 1000) - unix
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function ContactRow({ c }: { c: Contact }) {
  return (
    <tr id={`contact-${c.id}`}>
      <td>{c.name || <span className="muted">(no name)</span>}</td>
      <td>{c.email}</td>
      <td className="muted">{c.aliases || '—'}</td>
      <td className="muted contacts-hide-mobile">{fmtSource(c.source)}</td>
      <td className="muted contacts-hide-mobile">{fmtAgo(c.last_seen_at)}</td>
      <td>
        <button
          className="btn-danger btn-sm"
          hx-delete={`/admin/contacts/${c.id}`}
          hx-target={`#contact-${c.id}`}
          hx-swap="outerHTML"
          hx-confirm="Delete this contact?"
        >
          ✕
        </button>
      </td>
    </tr>
  )
}

function LoadMoreRow({ query, nextOffset }: { query: string; nextOffset: number }) {
  return (
    <tr id="contacts-load-more">
      <td colSpan={COL_COUNT + 1} className="load-more-cell">
        <button
          type="button"
          className="btn-primary"
          hx-get={`/admin/contacts/search?q=${encodeURIComponent(query)}&offset=${nextOffset}`}
          hx-target="#contacts-load-more"
          hx-swap="outerHTML"
        >
          Load more
        </button>
      </td>
    </tr>
  )
}

function ContactRowsFragment({
  contacts,
  query,
  nextOffset,
}: {
  contacts: Contact[]
  query: string
  nextOffset: number | null
}) {
  return (
    <>
      {contacts.map(c => <ContactRow key={c.id} c={c} />)}
      {nextOffset != null && <LoadMoreRow query={query} nextOffset={nextOffset} />}
    </>
  )
}

function ContactsTable({
  contacts,
  query,
  nextOffset,
}: {
  contacts: Contact[]
  query: string
  nextOffset: number | null
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Aliases</th>
            <th className="contacts-hide-mobile">Source</th>
            <th className="contacts-hide-mobile">Last seen</th>
            <th aria-label="actions" />
          </tr>
        </thead>
        <tbody id="contacts-tbody">
          {contacts.length === 0 ? (
            <tr>
              <td colSpan={COL_COUNT + 1} className="muted">
                {query ? `No contacts match "${query}".` : 'No contacts yet. They appear automatically as emails arrive.'}
              </td>
            </tr>
          ) : (
            <ContactRowsFragment contacts={contacts} query={query} nextOffset={nextOffset} />
          )}
        </tbody>
      </table>
    </div>
  )
}

interface ContactsPageProps {
  csrfToken: string
  total: number
  contacts: Contact[]
  query: string
  nextOffset: number | null
  syncResult?: string
}

function ContactsPage({ csrfToken, total, contacts, query, nextOffset, syncResult }: ContactsPageProps) {
  return (
    <Layout title="Contacts" csrfToken={csrfToken} currentPath="/admin/contacts">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Contacts</h2>
        <span className="muted" style={{ fontSize: '13px' }}>{total} total</span>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="search"
          name="q"
          placeholder="Search by name, email, or alias…"
          defaultValue={query}
          style={{ flex: '1', minWidth: '200px', maxWidth: '400px' }}
          hx-get="/admin/contacts/search"
          hx-trigger="input changed delay:300ms, search"
          hx-target="#contacts-tbody"
          hx-swap="innerHTML"
          hx-include="[name='q']"
        />
        <button
          className="btn-primary"
          hx-post="/admin/contacts/sync"
          hx-target="#sync-status"
          hx-swap="innerHTML"
          hx-indicator="#sync-status"
        >
          Sync Google Contacts
        </button>
        <span id="sync-status" className="muted" style={{ fontSize: '13px' }}>
          {syncResult ?? ''}
        </span>
      </div>

      <ContactsTable contacts={contacts} query={query} nextOffset={nextOffset} />
    </Layout>
  )
}

function fetchPage(query: string, offset: number) {
  const fetched = query
    ? searchContacts(query, offset, PAGE_SIZE + 1)
    : (() => {
        const r = listContacts(offset, PAGE_SIZE + 1)
        return { contacts: r.contacts, total: r.total }
      })()

  const contacts = fetched.contacts.slice(0, PAGE_SIZE)
  const nextOffset = fetched.contacts.length > PAGE_SIZE ? offset + PAGE_SIZE : null
  return { contacts, total: fetched.total, nextOffset }
}

export const contactsRoutes = new Hono()

contactsRoutes.get('/', (c) => {
  const csrfToken = c.get('csrf_token') as string
  const query = c.req.query('q') ?? ''
  const { contacts, total, nextOffset } = fetchPage(query, 0)
  return c.html(renderPage(
    <ContactsPage csrfToken={csrfToken} total={total} contacts={contacts} query={query} nextOffset={nextOffset} />
  ))
})

contactsRoutes.get('/search', (c) => {
  const query = c.req.query('q') ?? ''
  const offsetRaw = Number(c.req.query('offset') ?? 0)
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0
  const { contacts, nextOffset } = fetchPage(query, offset)

  if (offset === 0) {
    // Full tbody replacement (search box input)
    return c.html(renderFragment(
      <ContactRowsFragment contacts={contacts} query={query} nextOffset={nextOffset} />
    ))
  }
  // Load-more: replace the load-more row with new rows + possibly another load-more
  return c.html(renderFragment(
    <ContactRowsFragment contacts={contacts} query={query} nextOffset={nextOffset} />
  ))
})

contactsRoutes.post('/sync', async (c) => {
  const gmailUserId = process.env.OWNER_EMAIL
  if (!gmailUserId) {
    return c.html(renderFragment(<span className="muted" style={{ color: 'var(--err)' }}>OWNER_EMAIL not set</span>))
  }
  try {
    const accessToken = await getValidGmailAccessToken(gmailUserId)
    const count = await syncGoogleContacts(accessToken)
    return c.html(renderFragment(
      <span style={{ color: 'var(--ok)' }}>Synced {count} contacts from Google</span>
    ))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return c.html(renderFragment(<span style={{ color: 'var(--err)' }}>{msg}</span>))
  }
})

contactsRoutes.delete('/:id', (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id) || id <= 0) return c.html('', 400)
  deleteContact(id)
  return c.html('')
})
