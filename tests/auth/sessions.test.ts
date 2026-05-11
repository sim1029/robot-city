import { describe, expect, test, beforeAll, beforeEach } from 'bun:test'
import { db } from '../../src/db/client'
import { migrate } from '../../src/db/schema'
import { createSession, getSession, deleteSession, cleanupExpiredSessions } from '../../src/auth/sessions'

describe('admin sessions', () => {
  beforeAll(() => {
    migrate()
  })
  beforeEach(() => {
    db.run('DELETE FROM admin_sessions')
  })

  test('createSession inserts a row and returns id + csrfToken', () => {
    const { id, csrfToken, maxAgeSec } = createSession('discord-user-1')
    expect(id).toMatch(/^[0-9a-f]{64}$/)
    expect(csrfToken).toMatch(/^[0-9a-f]{64}$/)
    expect(id).not.toBe(csrfToken)
    expect(maxAgeSec).toBe(30 * 24 * 60 * 60)

    const row = db.query('SELECT * FROM admin_sessions WHERE id = ?').get(id) as { discord_user_id: string; csrf_token: string }
    expect(row.discord_user_id).toBe('discord-user-1')
    expect(row.csrf_token).toBe(csrfToken)
  })

  test('getSession returns the session for a valid id, null otherwise', () => {
    const { id } = createSession('discord-user-1')
    const session = getSession(id)
    expect(session?.discord_user_id).toBe('discord-user-1')
    expect(getSession('nonexistent')).toBeNull()
  })

  test('getSession lazy-deletes expired sessions', () => {
    const { id } = createSession('discord-user-1')
    db.run('UPDATE admin_sessions SET expires_at = ? WHERE id = ?', [Math.floor(Date.now() / 1000) - 60, id])
    expect(getSession(id)).toBeNull()
    expect(db.query('SELECT COUNT(*) as n FROM admin_sessions').get()).toEqual({ n: 0 })
  })

  test('getSession touches last_seen_at on read', async () => {
    const { id } = createSession('discord-user-1')
    db.run('UPDATE admin_sessions SET last_seen_at = 0 WHERE id = ?', [id])
    getSession(id)
    const row = db.query('SELECT last_seen_at FROM admin_sessions WHERE id = ?').get(id) as { last_seen_at: number }
    expect(row.last_seen_at).toBeGreaterThan(0)
  })

  test('deleteSession removes the row', () => {
    const { id } = createSession('discord-user-1')
    deleteSession(id)
    expect(getSession(id)).toBeNull()
  })

  test('cleanupExpiredSessions removes only expired rows', () => {
    const { id: live } = createSession('user-live')
    const { id: dead } = createSession('user-dead')
    db.run('UPDATE admin_sessions SET expires_at = ? WHERE id = ?', [Math.floor(Date.now() / 1000) - 60, dead])
    const removed = cleanupExpiredSessions()
    expect(removed).toBe(1)
    expect(getSession(live)).not.toBeNull()
    expect(getSession(dead)).toBeNull()
  })
})
