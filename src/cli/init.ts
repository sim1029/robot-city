#!/usr/bin/env bun
import { Hono } from 'hono'
import { getOAuthUrl, exchangeCode, getCurrentUser } from '../discord/oauth'
import { getOrCreateForumChannel } from '../discord/setup'
import { migrate } from '../db/schema'
import { db } from '../db/client'

migrate()

interface SetupData {
  guildId: string
  userId: string
  username: string
}

let resolveSetup!: (data: SetupData) => void
let rejectSetup!: (err: Error) => void
const setupDone = new Promise<SetupData>((res, rej) => {
  resolveSetup = res
  rejectSetup = rej
})

const oauthStates = new Map<string, number>()
const app = new Hono()

app.get('/auth/discord', (c) => {
  const state = crypto.randomUUID()
  oauthStates.set(state, Date.now() + 10 * 60 * 1000)
  return c.redirect(getOAuthUrl(state))
})

app.get('/auth/discord/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')

  if (!code || !state) {
    rejectSetup(new Error('OAuth callback missing code or state'))
    return c.html(errorPage('Missing code or state'))
  }

  const expiry = oauthStates.get(state)
  if (!expiry || Date.now() > expiry) {
    rejectSetup(new Error('OAuth state invalid or expired'))
    return c.html(errorPage('Invalid or expired state — please run init again'))
  }
  oauthStates.delete(state)

  try {
    const tokens = await exchangeCode(code)
    const user = await getCurrentUser(tokens.access_token)
    const guildId = tokens.guild?.id

    if (!guildId) {
      rejectSetup(new Error('No server selected during OAuth'))
      return c.html(errorPage('No server selected — please run init again and choose a Discord server when prompted'))
    }

    db.run(
      `INSERT INTO discord_tokens (user_id, access_token, refresh_token, expires_at, guild_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at,
         guild_id = excluded.guild_id`,
      [user.id, tokens.access_token, tokens.refresh_token, Date.now() + tokens.expires_in * 1000, guildId]
    )

    resolveSetup({ guildId, userId: user.id, username: user.username })
    return c.html(successPage(user.username))
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    rejectSetup(error)
    return c.html(errorPage(error.message))
  }
})

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['cmd', '/c', 'start', url] : [cmd, url]
  Bun.spawn(args, { stdout: 'ignore', stderr: 'ignore' })
}

function preflight() {
  const required = ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_BOT_TOKEN', 'DISCORD_REDIRECT_URI']
  const missing = required.filter(k => !process.env[k])
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(', ')}`)
    console.error('Copy .env.example to .env and fill in your Discord app credentials.')
    process.exit(1)
  }
}

async function main() {
  preflight()

  const port = Number(process.env.PORT ?? 3000)
  const server = Bun.serve({ port, fetch: app.fetch })

  console.log('robot-city init')
  console.log('───────────────')

  const authUrl = `http://localhost:${port}/auth/discord`
  console.log(`\nOpening Discord OAuth in your browser...`)
  console.log(`If it doesn't open automatically, visit:\n  ${authUrl}\n`)
  openBrowser(authUrl)
  console.log('Waiting for Discord authorization...')

  try {
    const { guildId, username } = await setupDone

    console.log(`\nAuthorized as ${username}`)
    console.log('Creating #robot-city forum channel...')

    const result = await getOrCreateForumChannel(guildId)

    console.log(`\nSetup complete!`)
    console.log(`Channel: ${result.channelLink}`)
    console.log(`\nPost in #robot-city to start a session.`)
  } catch (err) {
    console.error(`\nSetup failed: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  } finally {
    server.stop()
  }
}

function successPage(username: string): string {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem">
    <h2>Connected as ${username}</h2>
    <p>You can close this tab — robot-city is finishing setup in your terminal.</p>
  </body></html>`
}

function errorPage(msg: string): string {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem">
    <h2>Setup failed</h2>
    <p>${msg}</p>
  </body></html>`
}

main()
