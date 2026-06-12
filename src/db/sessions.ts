import { and, count, eq, isNull, like, sql } from 'drizzle-orm'
import { db } from './client'
import { events, sessions } from './tables'

export function ensureSession(sessionId: string): void {
  const discordThreadId = sessionId.startsWith('discord:') ? sessionId.slice('discord:'.length) : null
  db.insert(sessions)
    .values({ id: sessionId, discordThreadId, totalCostUsd: 0 })
    .onConflictDoNothing()
    .run()
}

export function bumpSessionCost(sessionId: string, costUsd: number): void {
  ensureSession(sessionId)
  db.update(sessions)
    .set({ totalCostUsd: sql`${sessions.totalCostUsd} + ${costUsd}` })
    .where(eq(sessions.id, sessionId))
    .run()
}

export function getSessionCost(sessionId: string): number {
  const row = db.select({ totalCostUsd: sessions.totalCostUsd })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get()
  return row?.totalCostUsd ?? 0
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
  const sessionRow = db.select({
    id: sessions.id,
    discordThreadId: sessions.discordThreadId,
    totalCostUsd: sessions.totalCostUsd,
    closedAt: sessions.closedAt,
  }).from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!sessionRow) return null

  const tokens = db.select({
    inputTokens: sql<number>`COALESCE(SUM(${events.inputTokens}), 0)`,
    outputTokens: sql<number>`COALESCE(SUM(${events.outputTokens}), 0)`,
  }).from(events).where(eq(events.sessionId, sessionId)).get()!

  const msgRow = db.select({ n: count() })
    .from(events)
    .where(and(eq(events.sessionId, sessionId), eq(events.type, 'stage:reason')))
    .get()!

  const toolRow = db.select({ n: count() })
    .from(events)
    .where(and(eq(events.sessionId, sessionId), like(events.type, 'tool:%')))
    .get()!

  return {
    sessionId: sessionRow.id,
    threadId: sessionRow.discordThreadId,
    totalCostUsd: sessionRow.totalCostUsd,
    totalInputTokens: tokens.inputTokens,
    totalOutputTokens: tokens.outputTokens,
    messageCount: msgRow.n,
    toolCount: toolRow.n,
    closedAt: sessionRow.closedAt,
  }
}

export function markSessionClosed(sessionId: string): void {
  db.update(sessions)
    .set({ closedAt: sql`unixepoch()` })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.closedAt)))
    .run()
}
