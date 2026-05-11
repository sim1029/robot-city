import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import { getSession } from './sessions'

declare module 'hono' {
  interface ContextVariableMap {
    owner_discord_id: string
    csrf_token: string
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export async function requireOwner(c: Context, next: Next) {
  const ownerId = process.env.OWNER_DISCORD_ID
  const sessionId = getCookie(c, 'rc_sess')
  if (!sessionId) return reject(c)
  const session = getSession(sessionId)
  if (!session) return reject(c)
  if (!ownerId || session.discord_user_id !== ownerId) return reject(c)
  c.set('owner_discord_id', session.discord_user_id)
  c.set('csrf_token', session.csrf_token)
  await next()
}

function reject(c: Context) {
  const accept = c.req.header('Accept') ?? ''
  if (c.req.method === 'GET' && accept.includes('text/html')) {
    return c.redirect('/login')
  }
  return c.json({ error: 'Unauthorized' }, 401)
}

export async function csrf(c: Context, next: Next) {
  if (SAFE_METHODS.has(c.req.method)) return next()
  const cookieToken = getCookie(c, 'rc_csrf')
  const headerToken = c.req.header('X-CSRF-Token')
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return c.json({ error: 'CSRF token mismatch' }, 403)
  }
  await next()
}
