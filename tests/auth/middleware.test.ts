import { describe, expect, test, beforeAll, beforeEach, afterAll } from 'bun:test'
import { Hono } from 'hono'
import { sqlite as db } from '../../src/db/client'
import { migrate } from '../../src/db/schema'
import { createSession } from '../../src/auth/sessions'
import { requireOwner, csrf } from '../../src/auth/middleware'

const OWNER_ID = 'owner-discord-id-123'

function buildApp() {
  const app = new Hono()
  app.use('/protected/*', requireOwner, csrf)
  app.get('/protected/data', (c) => c.json({ ok: true, owner: c.get('owner_discord_id') }))
  app.post('/protected/mutate', (c) => c.json({ ok: true }))
  return app
}

function authedRequest(url: string, init: RequestInit & { sessionId?: string; csrfToken?: string } = {}) {
  const headers = new Headers(init.headers)
  const cookies: string[] = []
  if (init.sessionId) cookies.push(`rc_sess=${init.sessionId}`)
  if (init.csrfToken) {
    cookies.push(`rc_csrf=${init.csrfToken}`)
    headers.set('X-CSRF-Token', init.csrfToken)
  }
  if (cookies.length) headers.set('Cookie', cookies.join('; '))
  return new Request(url, { ...init, headers })
}

describe('requireOwner + csrf middleware', () => {
  beforeAll(() => {
    migrate()
    process.env.OWNER_DISCORD_ID = OWNER_ID
  })
  beforeEach(() => {
    db.run('DELETE FROM admin_sessions')
  })
  afterAll(() => {
    delete process.env.OWNER_DISCORD_ID
  })

  test('GET without cookie → 401 (JSON request) or 302 to /login (HTML request)', async () => {
    const app = buildApp()
    const jsonRes = await app.fetch(new Request('http://localhost/protected/data'))
    expect(jsonRes.status).toBe(401)

    const htmlRes = await app.fetch(new Request('http://localhost/protected/data', { headers: { Accept: 'text/html' } }))
    expect(htmlRes.status).toBe(302)
    expect(htmlRes.headers.get('Location')).toBe('/login')
  })

  test('POST without cookie → 401 (never redirects)', async () => {
    const app = buildApp()
    const res = await app.fetch(new Request('http://localhost/protected/mutate', {
      method: 'POST',
      headers: { Accept: 'text/html' },
    }))
    expect(res.status).toBe(401)
  })

  test('GET with bogus session cookie → 401', async () => {
    const app = buildApp()
    const res = await app.fetch(authedRequest('http://localhost/protected/data', { sessionId: 'not-a-real-session' }))
    expect(res.status).toBe(401)
  })

  test('GET with valid session but wrong owner → 401', async () => {
    const app = buildApp()
    const { id } = createSession('different-user-id')
    const res = await app.fetch(authedRequest('http://localhost/protected/data', { sessionId: id }))
    expect(res.status).toBe(401)
  })

  test('GET with valid owner session → 200 and context is populated', async () => {
    const app = buildApp()
    const { id } = createSession(OWNER_ID)
    const res = await app.fetch(authedRequest('http://localhost/protected/data', { sessionId: id }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, owner: OWNER_ID })
  })

  test('POST with valid owner session but no CSRF header → 403', async () => {
    const app = buildApp()
    const { id, csrfToken } = createSession(OWNER_ID)
    const res = await app.fetch(new Request('http://localhost/protected/mutate', {
      method: 'POST',
      headers: { Cookie: `rc_sess=${id}; rc_csrf=${csrfToken}` },
    }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'CSRF token mismatch' })
  })

  test('POST with mismatched CSRF token → 403', async () => {
    const app = buildApp()
    const { id, csrfToken } = createSession(OWNER_ID)
    const res = await app.fetch(new Request('http://localhost/protected/mutate', {
      method: 'POST',
      headers: {
        Cookie: `rc_sess=${id}; rc_csrf=${csrfToken}`,
        'X-CSRF-Token': 'wrong-token',
      },
    }))
    expect(res.status).toBe(403)
  })

  test('POST with matching CSRF token → 200', async () => {
    const app = buildApp()
    const { id, csrfToken } = createSession(OWNER_ID)
    const res = await app.fetch(authedRequest('http://localhost/protected/mutate', {
      method: 'POST',
      sessionId: id,
      csrfToken,
    }))
    expect(res.status).toBe(200)
  })

  test('GET requests bypass CSRF (no header required)', async () => {
    const app = buildApp()
    const { id } = createSession(OWNER_ID)
    const res = await app.fetch(authedRequest('http://localhost/protected/data', { sessionId: id }))
    expect(res.status).toBe(200)
  })

  test('OWNER_DISCORD_ID unset → all access denied even with valid session', async () => {
    const app = buildApp()
    const { id } = createSession(OWNER_ID)
    delete process.env.OWNER_DISCORD_ID
    const res = await app.fetch(authedRequest('http://localhost/protected/data', { sessionId: id }))
    expect(res.status).toBe(401)
    process.env.OWNER_DISCORD_ID = OWNER_ID
  })
})
