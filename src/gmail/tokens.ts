import { db } from '../db/client'
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
  db.run(
    `INSERT INTO gmail_tokens (user_id, access_token, refresh_token, expires_at, scope, history_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(user_id) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       scope = excluded.scope,
       history_id = COALESCE(excluded.history_id, gmail_tokens.history_id),
       updated_at = unixepoch()`,
    [t.user_id, t.access_token, t.refresh_token, t.expires_at, t.scope, t.history_id ?? null]
  )
}

export function loadGmailTokens(userId: string): GmailTokenRow | null {
  const row = db
    .query('SELECT user_id, access_token, refresh_token, expires_at, scope, history_id FROM gmail_tokens WHERE user_id = ?')
    .get(userId) as GmailTokenRow | null
  return row ?? null
}

export function setGmailHistoryId(userId: string, historyId: string): void {
  db.run('UPDATE gmail_tokens SET history_id = ?, updated_at = unixepoch() WHERE user_id = ?', [historyId, userId])
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
