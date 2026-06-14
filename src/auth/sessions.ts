import { eq, lt } from 'drizzle-orm'
import { db } from '../db/client'
import { adminSessions } from '../db/tables'

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
  db.insert(adminSessions)
    .values({ id, discordUserId, csrfToken, createdAt: now, expiresAt, lastSeenAt: now })
    .run()
  return { id, csrfToken, maxAgeSec: SESSION_TTL_SEC }
}

export function getSession(id: string): AdminSession | null {
  const row = db.select().from(adminSessions).where(eq(adminSessions.id, id)).get()
  if (!row) return null
  const now = Math.floor(Date.now() / 1000)
  if (row.expiresAt < now) {
    db.delete(adminSessions).where(eq(adminSessions.id, id)).run()
    return null
  }
  db.update(adminSessions).set({ lastSeenAt: now }).where(eq(adminSessions.id, id)).run()
  return {
    id: row.id,
    discord_user_id: row.discordUserId,
    csrf_token: row.csrfToken,
    created_at: row.createdAt,
    expires_at: row.expiresAt,
    last_seen_at: now,
  }
}

export function deleteSession(id: string): void {
  db.delete(adminSessions).where(eq(adminSessions.id, id)).run()
}

export function cleanupExpiredSessions(): number {
  const now = Math.floor(Date.now() / 1000)
  const deleted = db.delete(adminSessions).where(lt(adminSessions.expiresAt, now)).returning({ id: adminSessions.id }).all()
  return deleted.length
}
