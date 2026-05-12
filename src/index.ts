import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { snapshotDb } from './db/snapshot'
import { migrate } from './db/schema'
import { db } from './db/client'
import { getKey, setKey } from './vault'
import { runStage, runPipeline, buildFooter } from './stages/runner'
import { getOAuthUrl, exchangeCode, getCurrentUser } from './discord/oauth'
import { getGmailAuthUrl, exchangeGmailCode } from './gmail/oauth'
import { saveGmailTokens } from './gmail/tokens'
import { getProfile } from './gmail/client'
import { runTriageTick } from './gmail/triage_loop'
import { registerSendEmailTool } from './tools/send_email'
import { registerInviteAttendeesTool } from './tools/invite_attendees'
import { startBot } from './discord/bot'
import { startScheduler } from './cron/scheduler'
import { generateBrief } from './workflows/morning_brief'
import { getAllSettings, getSetting, setSetting } from './db/settings'
import { requireOwner, csrf } from './auth/middleware'
import { cleanupExpiredSessions } from './auth/sessions'
import { authRouter } from './auth/discord_login'
import { loginRoutes } from './admin/login_page'
import { adminRouter } from './admin/router'
import type { StageName } from './stages/types'

snapshotDb()
migrate()
cleanupExpiredSessions()

if (!process.env.OWNER_DISCORD_ID) {
  console.warn('[auth] OWNER_DISCORD_ID is not set — admin dashboard will reject all logins until configured.')
}

const app = new Hono()

// ── Static admin assets (NO auth — must be registered before /admin/* middleware) ─

app.use('/admin/static/*', serveStatic({ root: './public' }))

// ── Auth middleware on protected groups ───────────────────────────────────────

app.use('/admin', requireOwner, csrf)
app.use('/admin/*', requireOwner, csrf)
app.use('/auth/logout', requireOwner, csrf)
app.use('/vault/*', requireOwner, csrf)
app.use('/settings', requireOwner, csrf)
app.use('/settings/*', requireOwner, csrf)
app.use('/cron/*', requireOwner, csrf)
app.use('/events', requireOwner, csrf)
app.use('/stages/*', requireOwner, csrf)
app.use('/gmail/poll', requireOwner, csrf)

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (c) => c.json({ status: 'ok', ts: Date.now() }))

// ── Admin dashboard login + session ───────────────────────────────────────────

app.route('/', loginRoutes)
app.route('/', authRouter)
app.route('/admin', adminRouter)

// ── Discord OAuth ─────────────────────────────────────────────────────────────

const oauthStates = new Map<string, number>()

app.get('/auth/discord', (c) => {
  const state = crypto.randomUUID()
  oauthStates.set(state, Date.now() + 10 * 60 * 1000)
  return c.redirect(getOAuthUrl(state))
})

app.get('/auth/discord/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')

  if (!code || !state) return c.json({ error: 'Missing code or state' }, 400)

  const expiry = oauthStates.get(state)
  if (!expiry || Date.now() > expiry) return c.json({ error: 'Invalid or expired state' }, 400)
  oauthStates.delete(state)

  try {
    const tokens = await exchangeCode(code)
    const user = await getCurrentUser(tokens.access_token)
    const guildId = tokens.guild?.id ?? null

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

    return c.json({ ok: true, user: { id: user.id, username: user.username }, guild_id: guildId })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// ── Gmail + Calendar OAuth ────────────────────────────────────────────────────

const gmailOauthStates = new Map<string, number>()

app.get('/auth/google', (c) => {
  const state = crypto.randomUUID()
  gmailOauthStates.set(state, Date.now() + 10 * 60 * 1000)
  return c.redirect(getGmailAuthUrl(state))
})

app.get('/auth/google/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!code || !state) return c.json({ error: 'Missing code or state' }, 400)

  const expiry = gmailOauthStates.get(state)
  if (!expiry || Date.now() > expiry) return c.json({ error: 'Invalid or expired state' }, 400)
  gmailOauthStates.delete(state)

  try {
    const tokens = await exchangeGmailCode(code)
    const profile = await getProfile(tokens.access_token)
    saveGmailTokens({
      user_id: profile.emailAddress,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
      scope: tokens.scope,
      history_id: profile.historyId,
    })
    registerSendEmailTool(profile.emailAddress)
    registerInviteAttendeesTool(profile.emailAddress)
    return c.json({ ok: true, email: profile.emailAddress })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.post('/gmail/poll', async (c) => {
  const body = await c.req.json<{ gmail_user_id?: string; discord_user_id?: string }>()
  if (!body.gmail_user_id || !body.discord_user_id) {
    return c.json({ error: 'gmail_user_id and discord_user_id required' }, 400)
  }
  try {
    const result = await runTriageTick({
      gmailUserId: body.gmail_user_id,
      discordUserId: body.discord_user_id,
    })
    return c.json(result)
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// ── User Settings ─────────────────────────────────────────────────────────────

app.get('/settings', (c) => c.json(getAllSettings()))

app.put('/settings/:key', async (c) => {
  const key = c.req.param('key')
  const body = await c.req.json<{ value?: string }>()
  if (!body.value && body.value !== '') return c.json({ error: 'Missing "value"' }, 400)
  setSetting(key, body.value)
  return c.json({ ok: true, key, value: body.value })
})

// ── Cron brief (manual trigger for testing) ───────────────────────────────────

app.post('/cron/brief', async (c) => {
  const gmailRow = db.query('SELECT user_id FROM gmail_tokens LIMIT 1').get() as { user_id: string } | null
  const discordRow = db.query('SELECT user_id FROM discord_tokens LIMIT 1').get() as { user_id: string } | null

  if (!gmailRow || !discordRow) {
    return c.json({ error: 'Gmail and Discord accounts must be connected first' }, 400)
  }

  const rawBody = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const labelArg = String(rawBody.label ?? '')
  const label = (['morning', 'midday', 'evening'].includes(labelArg) ? labelArg : 'morning') as 'morning' | 'midday' | 'evening'

  try {
    await generateBrief({ gmailUserId: gmailRow.user_id, discordUserId: discordRow.user_id, label })
    return c.json({ ok: true, label })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// ── Vault ─────────────────────────────────────────────────────────────────────

app.post('/vault/keys/:provider', async (c) => {
  const provider = c.req.param('provider')
  const body = await c.req.json<{ key?: string }>()
  if (!body.key) return c.json({ error: 'Missing "key" in request body' }, 400)
  await setKey(provider, body.key)
  return c.json({ ok: true, provider })
})

app.get('/vault/keys/:provider', async (c) => {
  const provider = c.req.param('provider')
  try {
    await getKey(provider)
    return c.json({ ok: true, provider, set: true })
  } catch {
    return c.json({ ok: false, provider, set: false })
  }
})

// ── Stage runner ──────────────────────────────────────────────────────────────

const VALID_STAGES: StageName[] = ['classify', 'gather', 'reason', 'act']

app.post('/stages/run', async (c) => {
  const body = await c.req.json<{ stage?: string; prompt?: string; session_id?: string }>()
  const { stage, prompt, session_id } = body

  if (!stage || !prompt) return c.json({ error: 'Missing "stage" or "prompt"' }, 400)
  if (!VALID_STAGES.includes(stage as StageName)) {
    return c.json({ error: `Invalid stage "${stage}". Valid: ${VALID_STAGES.join(', ')}` }, 400)
  }

  try {
    const result = await runStage(stage as StageName, prompt, session_id ?? null)
    return c.json({ ...result, footer: buildFooter([result]) })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

app.post('/stages/pipeline', async (c) => {
  const body = await c.req.json<{ prompt?: string; session_id?: string; stages?: string[] }>()
  const { prompt, session_id, stages } = body

  if (!prompt) return c.json({ error: 'Missing "prompt"' }, 400)

  const pipeline = (stages ?? ['classify', 'reason']) as StageName[]
  const invalid = pipeline.filter(s => !VALID_STAGES.includes(s))
  if (invalid.length) return c.json({ error: `Invalid stages: ${invalid.join(', ')}` }, 400)

  try {
    const result = await runPipeline(prompt, session_id ?? null, pipeline)
    return c.json(result)
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// ── Event log ─────────────────────────────────────────────────────────────────

app.get('/events', (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 500)
  const sessionId = c.req.query('session_id')
  const events = sessionId
    ? db.query('SELECT * FROM events WHERE session_id = ? ORDER BY created_at DESC LIMIT ?').all(sessionId, limit)
    : db.query('SELECT * FROM events ORDER BY created_at DESC LIMIT ?').all(limit)
  return c.json({ events })
})

// ── Server ────────────────────────────────────────────────────────────────────

// Restore tool handlers for any Gmail account already onboarded
for (const row of db.query('SELECT user_id FROM gmail_tokens').all() as Array<{ user_id: string }>) {
  registerSendEmailTool(row.user_id)
  registerInviteAttendeesTool(row.user_id)
}

if (process.env.DISCORD_BOT_TOKEN) {
  startBot()
    .then(() => {
      // Start daily brief scheduler once bot is live
      const gmailRow = db.query('SELECT user_id FROM gmail_tokens LIMIT 1').get() as { user_id: string } | null
      const discordRow = db.query('SELECT user_id FROM discord_tokens LIMIT 1').get() as { user_id: string } | null
      if (gmailRow && discordRow) {
        startScheduler({ gmailUserId: gmailRow.user_id, discordUserId: discordRow.user_id })
        console.log(`[cron] Scheduler started for ${gmailRow.user_id} (timezone: ${getSetting('timezone', 'UTC')})`)
      }
    })
    .catch((err) => console.error('Discord bot failed to start:', err))
}

const port = Number(process.env.PORT ?? 3000)
console.log(`robot-city listening on http://localhost:${port}`)

export default { port, fetch: app.fetch }
