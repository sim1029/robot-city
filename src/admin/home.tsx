import { Hono } from 'hono'
import { db } from '../db/client'
import { Layout } from './components/Layout'
import { renderPage } from './render'

interface EventRow {
  id: number
  session_id: string | null
  type: string
  model: string | null
  input_tokens: number | null
  output_tokens: number | null
  cost_usd: number | null
  latency_ms: number | null
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

function EventsTable({ rows }: { rows: EventRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
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
            <tr>
              <td colSpan={8} className="muted">No events yet.</td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
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
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{fmtAgo(r.created_at)}</td>
              <td>{r.type}</td>
              <td>{r.model ?? '—'}</td>
              <td className="num">{r.input_tokens ?? '—'}</td>
              <td className="num">{r.output_tokens ?? '—'}</td>
              <td className="num">{r.cost_usd != null ? fmtUsd(r.cost_usd) : '—'}</td>
              <td className="num">{r.latency_ms != null ? `${r.latency_ms}ms` : '—'}</td>
              <td className="muted">{r.session_id ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface HomePageProps {
  csrfToken: string
  day: CostTotals
  week: CostTotals
  recent: EventRow[]
}

function HomePage({ csrfToken, day, week, recent }: HomePageProps) {
  return (
    <Layout title="Home" csrfToken={csrfToken} currentPath="/admin">
      <section className="cards">
        <StatCard label="Last 24h" totals={day} />
        <StatCard label="Last 7d" totals={week} />
      </section>
      <h2>Recent events</h2>
      <EventsTable rows={recent} />
    </Layout>
  )
}

export const homeRoutes = new Hono()

homeRoutes.get('/', (c) => {
  const csrfToken = c.get('csrf_token') as string

  const dayAgo = Math.floor(Date.now() / 1000) - 86400
  const weekAgo = Math.floor(Date.now() / 1000) - 7 * 86400

  const day = db.query(
    `SELECT COALESCE(SUM(cost_usd),0) AS total_cost,
            COALESCE(SUM(input_tokens),0) AS total_input,
            COALESCE(SUM(output_tokens),0) AS total_output,
            COUNT(*) AS event_count
     FROM events WHERE created_at >= ?`
  ).get(dayAgo) as CostTotals

  const week = db.query(
    `SELECT COALESCE(SUM(cost_usd),0) AS total_cost,
            COALESCE(SUM(input_tokens),0) AS total_input,
            COALESCE(SUM(output_tokens),0) AS total_output,
            COUNT(*) AS event_count
     FROM events WHERE created_at >= ?`
  ).get(weekAgo) as CostTotals

  const recent = db.query(
    `SELECT id, session_id, type, model, input_tokens, output_tokens, cost_usd, latency_ms, created_at
     FROM events ORDER BY created_at DESC LIMIT 50`
  ).all() as EventRow[]

  return c.html(renderPage(<HomePage csrfToken={csrfToken} day={day} week={week} recent={recent} />))
})
