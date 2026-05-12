import { Hono } from 'hono'
import type { Context } from 'hono'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import { exchangeCode, getCurrentUser } from '../discord/oauth'
import { createSession, deleteSession } from './sessions'

const STATE_TTL_MS = 10 * 60 * 1000

const loginStates = new Map<string, number>()

function getLoginRedirectUri(c: Context): string {
  const uri = process.env.DISCORD_LOGIN_REDIRECT_URI
  if (uri) return uri
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DISCORD_LOGIN_REDIRECT_URI must be set in production')
  }
  return `${new URL(c.req.url).origin}/auth/discord/login/callback`
}

function buildLoginAuthUrl(c: Context, state: string): string {
  const clientId = process.env.DISCORD_CLIENT_ID
  if (!clientId) throw new Error('DISCORD_CLIENT_ID must be set')
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getLoginRedirectUri(c),
    response_type: 'code',
    scope: 'identify',
    state,
  })
  return `https://discord.com/oauth2/authorize?${params}`
}

function pruneExpiredStates() {
  const now = Date.now()
  for (const [k, exp] of loginStates) if (exp < now) loginStates.delete(k)
}

export const authRouter = new Hono()

authRouter.get('/auth/discord/login', (c) => {
  const state = crypto.randomUUID()
  loginStates.set(state, Date.now() + STATE_TTL_MS)
  if (loginStates.size > 100) pruneExpiredStates()
  return c.redirect(buildLoginAuthUrl(c, state))
})

authRouter.get('/auth/discord/login/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!code || !state) return c.text('Missing code or state', 400)
  const expiry = loginStates.get(state)
  if (!expiry || Date.now() > expiry) return c.text('Invalid or expired state', 400)
  loginStates.delete(state)

  const ownerId = process.env.OWNER_DISCORD_ID
  if (!ownerId) {
    return c.text('OWNER_DISCORD_ID is not configured. Set it as a server secret before logging in.', 503)
  }

  try {
    const tokens = await exchangeCode(code, getLoginRedirectUri(c))
    const user = await getCurrentUser(tokens.access_token)
    if (user.id !== ownerId) {
      return c.text('This Discord account is not the configured owner.', 403)
    }
    const { id: sessionId, csrfToken, maxAgeSec } = createSession(user.id)
    const isProd = process.env.NODE_ENV === 'production'
    setCookie(c, 'rc_sess', sessionId, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'Lax',
      path: '/',
      maxAge: maxAgeSec,
    })
    setCookie(c, 'rc_csrf', csrfToken, {
      httpOnly: false,
      secure: isProd,
      sameSite: 'Lax',
      path: '/',
      maxAge: maxAgeSec,
    })
    return c.redirect('/admin')
  } catch (err) {
    return c.text(`Login failed: ${err}`, 500)
  }
})

authRouter.post('/auth/logout', (c) => {
  const sessionId = getCookie(c, 'rc_sess')
  if (sessionId) deleteSession(sessionId)
  deleteCookie(c, 'rc_sess', { path: '/' })
  deleteCookie(c, 'rc_csrf', { path: '/' })
  if (c.req.header('HX-Request')) {
    c.header('HX-Redirect', '/login')
    return c.body(null, 200)
  }
  return c.redirect('/login')
})
