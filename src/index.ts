import { Hono } from 'hono'
import { migrate } from './db/schema'
import { db } from './db/client'
import { getKey, setKey } from './vault'
import { runStage, runPipeline, buildFooter } from './stages/runner'
import { getOAuthUrl, exchangeCode, getCurrentUser } from './discord/oauth'
import type { StageName } from './stages/types'

migrate()

const app = new Hono()

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (c) => c.json({ status: 'ok', ts: Date.now() }))

// ── Discord OAuth ─────────────────────────────────────────────────────────────

// Ephemeral CSRF state map (single-user; in-memory is fine)
const oauthStates = new Map<string, number>()

app.get('/auth/discord', (c) => {
  const state = crypto.randomUUID()
  oauthStates.set(state, Date.now() + 10 * 60 * 1000) // 10 min TTL
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

const port = Number(process.env.PORT ?? 3000)
console.log(`robot-city listening on http://localhost:${port}`)

export default { port, fetch: app.fetch }
