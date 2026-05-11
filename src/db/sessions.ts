import { db } from './client'

export function ensureSession(sessionId: string): void {
  const discordThreadId = sessionId.startsWith('discord:') ? sessionId.slice('discord:'.length) : null
  db.run(
    `INSERT OR IGNORE INTO sessions (id, discord_thread_id, created_at, total_cost_usd)
     VALUES (?, ?, unixepoch(), 0)`,
    [sessionId, discordThreadId]
  )
}

export function bumpSessionCost(sessionId: string, costUsd: number): void {
  ensureSession(sessionId)
  db.run('UPDATE sessions SET total_cost_usd = total_cost_usd + ? WHERE id = ?', [costUsd, sessionId])
}

export function getSessionCost(sessionId: string): number {
  const row = db.query('SELECT total_cost_usd FROM sessions WHERE id = ?').get(sessionId) as { total_cost_usd: number } | null
  return row?.total_cost_usd ?? 0
}

export interface SessionStats {
  sessionId: string
  threadId: string | null
  totalCostUsd: number
  totalInputTokens: number
  totalOutputTokens: number
  messageCount: number
  toolCount: number
  closedAt: number | null
}

export function computeSessionStats(sessionId: string): SessionStats | null {
  const sessionRow = db.query(
    `SELECT id, discord_thread_id, total_cost_usd, closed_at FROM sessions WHERE id = ?`
  ).get(sessionId) as { id: string; discord_thread_id: string | null; total_cost_usd: number; closed_at: number | null } | null
  if (!sessionRow) return null

  const tokens = db.query(
    `SELECT
       COALESCE(SUM(input_tokens), 0)  AS input_tokens,
       COALESCE(SUM(output_tokens), 0) AS output_tokens
     FROM events WHERE session_id = ?`
  ).get(sessionId) as { input_tokens: number; output_tokens: number }

  const msgRow = db.query(
    `SELECT COUNT(*) AS n FROM events WHERE session_id = ? AND type = 'stage:reason'`
  ).get(sessionId) as { n: number }

  const toolRow = db.query(
    `SELECT COUNT(*) AS n FROM events WHERE session_id = ? AND type LIKE 'tool:%'`
  ).get(sessionId) as { n: number }

  return {
    sessionId: sessionRow.id,
    threadId: sessionRow.discord_thread_id,
    totalCostUsd: sessionRow.total_cost_usd,
    totalInputTokens: tokens.input_tokens,
    totalOutputTokens: tokens.output_tokens,
    messageCount: msgRow.n,
    toolCount: toolRow.n,
    closedAt: sessionRow.closed_at,
  }
}

export function markSessionClosed(sessionId: string): void {
  db.run('UPDATE sessions SET closed_at = unixepoch() WHERE id = ? AND closed_at IS NULL', [sessionId])
}
