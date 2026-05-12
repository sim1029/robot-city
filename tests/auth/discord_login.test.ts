import { afterEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { authRouter } from '../../src/auth/discord_login'

function buildApp() {
  const app = new Hono()
  app.route('/', authRouter)
  return app
}

describe('Discord admin login OAuth', () => {
  afterEach(() => {
    delete process.env.DISCORD_CLIENT_ID
    delete process.env.DISCORD_LOGIN_REDIRECT_URI
    delete process.env.NODE_ENV
  })

  test('uses configured login redirect URI when present', async () => {
    process.env.DISCORD_CLIENT_ID = 'discord-client-id'
    process.env.DISCORD_LOGIN_REDIRECT_URI = 'https://robot-city.fly.dev/auth/discord/login/callback'
    const res = await buildApp().fetch(new Request('http://localhost:3000/auth/discord/login'))

    expect(res.status).toBe(302)
    const url = new URL(res.headers.get('Location')!)
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize')
    expect(url.searchParams.get('redirect_uri')).toBe('https://robot-city.fly.dev/auth/discord/login/callback')
    expect(url.searchParams.get('scope')).toBe('identify')
  })

  test('infers localhost login redirect URI in local development', async () => {
    process.env.DISCORD_CLIENT_ID = 'discord-client-id'
    const res = await buildApp().fetch(new Request('http://localhost:3000/auth/discord/login'))

    expect(res.status).toBe(302)
    const url = new URL(res.headers.get('Location')!)
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/auth/discord/login/callback')
  })
})
