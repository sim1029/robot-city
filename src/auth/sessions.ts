import { db } from '../db/client'

const SESSION_TTL_SEC = 30 * 24 * 60 * 60

function randomToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export interface AdminSession {
  id: string
  discord_user_id: string
  csrf_token: string
  created_at: number
  expires_at: number
  last_seen_at: number
}

export function createSession(discordUserId: string): { id: string; csrfToken: string; maxAgeSec: number } {
  const id = randomToken()
  const csrfToken = randomToken()
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + SESSION_TTL_SEC
  db.run(
    `INSERT INTO admin_sessions (id, discord_user_id, csrf_token, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, discordUserId, csrfToken, now, expiresAt, now]
  )
  return { id, csrfToken, maxAgeSec: SESSION_TTL_SEC }
}

export function getSession(id: string): AdminSession | null {
  const row = db.query('SELECT * FROM admin_sessions WHERE id = ?').get(id) as AdminSession | null
  if (!row) return null
  const now = Math.floor(Date.now() / 1000)
  if (row.expires_at < now) {
    db.run('DELETE FROM admin_sessions WHERE id = ?', [id])
    return null
  }
  db.run('UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?', [now, id])
  return row
}

export function deleteSession(id: string): void {
  db.run('DELETE FROM admin_sessions WHERE id = ?', [id])
}

export function cleanupExpiredSessions(): number {
  const now = Math.floor(Date.now() / 1000)
  const result = db.run('DELETE FROM admin_sessions WHERE expires_at < ?', [now])
  return result.changes
}
