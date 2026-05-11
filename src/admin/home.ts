import { Hono } from 'hono'
import { db } from '../db/client'
import { layout, esc } from './layout'

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

  const rows = recent.map((r) => `
    <tr>
      <td>${fmtAgo(r.created_at)}</td>
      <td>${esc(r.type)}</td>
      <td>${esc(r.model ?? '—')}</td>
      <td class="num">${r.input_tokens ?? '—'}</td>
      <td class="num">${r.output_tokens ?? '—'}</td>
      <td class="num">${r.cost_usd != null ? fmtUsd(r.cost_usd) : '—'}</td>
      <td class="num">${r.latency_ms != null ? `${r.latency_ms}ms` : '—'}</td>
      <td class="muted">${esc(r.session_id ?? '—')}</td>
    </tr>
  `).join('')

  const body = `
    <section class="cards">
      <div class="card">
        <div class="card-label">Last 24h</div>
        <div class="card-value">${fmtUsd(day.total_cost)}</div>
        <div class="card-sub">${day.event_count} events · ${day.total_input} in / ${day.total_output} out</div>
      </div>
      <div class="card">
        <div class="card-label">Last 7d</div>
        <div class="card-value">${fmtUsd(week.total_cost)}</div>
        <div class="card-sub">${week.event_count} events · ${week.total_input} in / ${week.total_output} out</div>
      </div>
    </section>

    <h2>Recent events</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>When</th><th>Type</th><th>Model</th><th>In</th><th>Out</th><th>Cost</th><th>Latency</th><th>Session</th></tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="8" class="muted">No events yet.</td></tr>'}</tbody>
      </table>
    </div>
  `

  return c.html(layout({ title: 'Home', csrfToken, body, currentPath: '/admin' }))
})
