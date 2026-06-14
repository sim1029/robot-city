import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { gmailTokens } from '../db/tables'
import { refreshGmailAccessToken } from './oauth'

const REFRESH_SKEW_MS = 30_000

export interface GmailTokenRow {
  user_id: string
  access_token: string
  refresh_token: string
  expires_at: number
  scope: string
  history_id?: string | null
}

export function saveGmailTokens(t: GmailTokenRow): void {
  db.insert(gmailTokens)
    .values({
      userId: t.user_id,
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: t.expires_at,
      scope: t.scope,
      historyId: t.history_id ?? null,
      updatedAt: sql`unixepoch()`,
    })
    .onConflictDoUpdate({
      target: gmailTokens.userId,
      set: {
        accessToken: sql`excluded.access_token`,
        refreshToken: sql`excluded.refresh_token`,
        expiresAt: sql`excluded.expires_at`,
        scope: sql`excluded.scope`,
        historyId: sql`COALESCE(excluded.history_id, ${gmailTokens.historyId})`,
        updatedAt: sql`unixepoch()`,
      },
    })
    .run()
}

export function loadGmailTokens(userId: string): GmailTokenRow | null {
  const row = db.select().from(gmailTokens).where(eq(gmailTokens.userId, userId)).get()
  if (!row) return null
  return {
    user_id: row.userId,
    access_token: row.accessToken,
    refresh_token: row.refreshToken,
    expires_at: row.expiresAt,
    scope: row.scope,
    history_id: row.historyId,
  }
}

export function setGmailHistoryId(userId: string, historyId: string): void {
  db.update(gmailTokens)
    .set({ historyId, updatedAt: sql`unixepoch()` })
    .where(eq(gmailTokens.userId, userId))
    .run()
}

export async function getValidGmailAccessToken(userId: string): Promise<string> {
  const row = loadGmailTokens(userId)
  if (!row) throw new Error(`No Gmail tokens stored for ${userId}`)
  if (row.expires_at - REFRESH_SKEW_MS > Date.now()) return row.access_token

  const refreshed = await refreshGmailAccessToken(row.refresh_token)
  saveGmailTokens({
    ...row,
    access_token: refreshed.access_token,
    expires_at: Date.now() + refreshed.expires_in * 1000,
    scope: refreshed.scope ?? row.scope,
  })
  return refreshed.access_token
}
