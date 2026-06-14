import { Hono } from 'hono'
import { count, desc, gte, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { events } from '../db/tables'
import { Layout } from './components/Layout'
import { renderPage, renderFragment } from './render'

const PAGE_SIZE = 25
const COLUMN_COUNT = 9

interface EventRow {
  id: number
  session_id: string | null
  type: string
  model: string | null
  input_tokens: number | null
  output_tokens: number | null
  cost_usd: number | null
  latency_ms: number | null
  payload: string | null
  output: string | null
  created_at: number
}

interface CostTotals {
  total_cost: number
  total_input: number
  total_output: number
  event_count: number
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`
}

function fmtAgo(unix: number): string {
  const diff = Math.floor(Date.now() / 1000) - unix
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function formatPayload(payload: string | null): string {
  if (!payload) return ''
  try {
    const obj = JSON.parse(payload)
    if (obj && typeof obj === 'object' && 'prompt' in obj && typeof (obj as { prompt: unknown }).prompt === 'string') {
      return (obj as { prompt: string }).prompt
    }
    return JSON.stringify(obj, null, 2)
  } catch {
    return payload
  }
}

interface StatCardProps {
  label: string
  totals: CostTotals
}

function StatCard({ label, totals }: StatCardProps) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className="card-value">{fmtUsd(totals.total_cost)}</div>
      <div className="card-sub">
        {totals.event_count} events · {totals.total_input} in / {totals.total_output} out
      </div>
    </div>
  )
}

function EventDetailRow({ row }: { row: EventRow }) {
  const input = formatPayload(row.payload)
  const output = row.output
  const isStage = row.type.startsWith('stage:') || row.type.startsWith('workflow:')
  const inputHint = isStage ? '300-char preview · full prompts are not logged' : 'event payload'
  return (
    <tr id={`event-detail-${row.id}`} className="event-detail">
      <td colSpan={COLUMN_COUNT}>
        <div className="event-detail-inner">
          <div className="event-detail-section">
            <div className="event-detail-label">
              Input <span className="event-detail-hint">{inputHint}</span>
            </div>
            {input
              ? <pre>{input}</pre>
              : <pre className="muted">(empty)</pre>}
          </div>
          <div className="event-detail-section">
            <div className="event-detail-label">Response</div>
            {output
              ? <pre>{output}</pre>
              : <pre className="muted">(no model response)</pre>}
          </div>
        </div>
      </td>
    </tr>
  )
}

function EventRowPair({ row }: { row: EventRow }) {
  return (
    <>
      <tr className="event-row" data-detail-id={`event-detail-${row.id}`}>
        <td className="caret-cell"><span className="caret">▸</span></td>
        <td>{fmtAgo(row.created_at)}</td>
        <td>{row.type}</td>
        <td>{row.model ?? '—'}</td>
        <td className="num">{row.input_tokens ?? '—'}</td>
        <td className="num">{row.output_tokens ?? '—'}</td>
        <td className="num">{row.cost_usd != null ? fmtUsd(row.cost_usd) : '—'}</td>
        <td className="num">{row.latency_ms != null ? `${row.latency_ms}ms` : '—'}</td>
        <td className="muted">{row.session_id ?? '—'}</td>
      </tr>
      <EventDetailRow row={row} />
    </>
  )
}

function LoadMoreRow({ nextOffset }: { nextOffset: number }) {
  return (
    <tr id="load-more-row">
      <td colSpan={COLUMN_COUNT} className="load-more-cell">
        <button
          type="button"
          className="btn-primary"
          hx-get={`/admin/events?offset=${nextOffset}`}
          hx-target="#load-more-row"
          hx-swap="outerHTML"
        >
          Load more
        </button>
      </td>
    </tr>
  )
}

function EventRowsFragment({ rows, nextOffset }: { rows: EventRow[]; nextOffset: number | null }) {
  return (
    <>
      {rows.map((r) => <EventRowPair key={r.id} row={r} />)}
      {nextOffset != null && <LoadMoreRow nextOffset={nextOffset} />}
    </>
  )
}

function EventsTable({ rows, nextOffset }: { rows: EventRow[]; nextOffset: number | null }) {
  return (
    <div className="table-wrap">
      <table className="events-table">
        <thead>
          <tr>
            <th aria-label="expand" />
            <th>When</th>
            <th>Type</th>
            <th>Model</th>
            <th>In</th>
            <th>Out</th>
            <th>Cost</th>
            <th>Latency</th>
            <th>Session</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={COLUMN_COUNT} className="muted">No events yet.</td>
            </tr>
          ) : (
            <EventRowsFragment rows={rows} nextOffset={nextOffset} />
          )}
        </tbody>
      </table>
    </div>
  )
}

const TOGGLE_SCRIPT = `
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest('button, a, input, select, textarea, label')) return;
    var row = t.closest('tr.event-row');
    if (!row) return;
    var id = row.getAttribute('data-detail-id');
    if (!id) return;
    var detail = document.getElementById(id);
    if (!detail) return;
    var open = detail.classList.toggle('open');
    row.classList.toggle('is-open', open);
  });
`

interface HomePageProps {
  csrfToken: string
  day: CostTotals
  week: CostTotals
  rows: EventRow[]
  nextOffset: number | null
}

function HomePage({ csrfToken, day, week, rows, nextOffset }: HomePageProps) {
  return (
    <Layout title="Home" csrfToken={csrfToken} currentPath="/admin">
      <section className="cards">
        <StatCard label="Last 24h" totals={day} />
        <StatCard label="Last 7d" totals={week} />
      </section>
      <h2>Recent events</h2>
      <EventsTable rows={rows} nextOffset={nextOffset} />
      <script dangerouslySetInnerHTML={{ __html: TOGGLE_SCRIPT }} />
    </Layout>
  )
}

function fetchEventPage(offset: number): { rows: EventRow[]; nextOffset: number | null } {
  const fetched: EventRow[] = db.select({
    id: events.id,
    session_id: events.sessionId,
    type: events.type,
    model: events.model,
    input_tokens: events.inputTokens,
    output_tokens: events.outputTokens,
    cost_usd: events.costUsd,
    latency_ms: events.latencyMs,
    payload: events.payload,
    output: events.output,
    created_at: events.createdAt,
  })
    .from(events)
    .orderBy(desc(events.createdAt), desc(events.id))
    .limit(PAGE_SIZE + 1)
    .offset(offset)
    .all()
  const rows = fetched.slice(0, PAGE_SIZE)
  const nextOffset = fetched.length > PAGE_SIZE ? offset + PAGE_SIZE : null
  return { rows, nextOffset }
}

export const homeRoutes = new Hono()

homeRoutes.get('/', (c) => {
  const csrfToken = c.get('csrf_token') as string

  const dayAgo = Math.floor(Date.now() / 1000) - 86400
  const weekAgo = Math.floor(Date.now() / 1000) - 7 * 86400

  const costTotalsSince = (since: number): CostTotals => db.select({
    total_cost: sql<number>`COALESCE(SUM(${events.costUsd}), 0)`,
    total_input: sql<number>`COALESCE(SUM(${events.inputTokens}), 0)`,
    total_output: sql<number>`COALESCE(SUM(${events.outputTokens}), 0)`,
    event_count: count(),
  }).from(events).where(gte(events.createdAt, since)).get()!

  const day = costTotalsSince(dayAgo)
  const week = costTotalsSince(weekAgo)

  const { rows, nextOffset } = fetchEventPage(0)

  return c.html(renderPage(<HomePage csrfToken={csrfToken} day={day} week={week} rows={rows} nextOffset={nextOffset} />))
})

homeRoutes.get('/events', (c) => {
  const raw = Number(c.req.query('offset') ?? 0)
  const offset = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
  const { rows, nextOffset } = fetchEventPage(offset)
  return c.html(renderFragment(<EventRowsFragment rows={rows} nextOffset={nextOffset} />))
})
