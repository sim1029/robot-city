import { Hono } from 'hono'
import { db } from '../db/client'
import { generateBrief } from '../workflows/morning_brief'
import { getProfile } from '../gmail/client'
import { saveGmailTokens } from '../gmail/tokens'
import { layout, esc } from './layout'

export const actionsRoutes = new Hono()

actionsRoutes.get('/', (c) => {
  const csrfToken = c.get('csrf_token') as string
  const body = `
    <h2>Actions</h2>
    <p class="muted">Manual triggers for debugging and ad-hoc operation.</p>

    <section class="action">
      <h3>Run brief now</h3>
      <p class="muted">Generates a Discord DM brief immediately, bypassing the cron schedule.</p>
      <div class="row">
        <select id="brief-label">
          <option value="morning">Morning</option>
          <option value="midday">Midday</option>
          <option value="evening">Evening</option>
        </select>
        <button class="btn-primary"
                hx-post="/admin/actions/run-brief"
                hx-include="#brief-label"
                hx-target="#brief-status"
                hx-swap="innerHTML">Run</button>
        <span id="brief-status" class="status"></span>
      </div>
    </section>

    <section class="action">
      <h3>Re-baseline Gmail history</h3>
      <p class="muted">Fetches the current Gmail <code>historyId</code> and skips forward, abandoning any unprocessed history. Use when Gmail returns a 404 on history (typically when the watermark is &gt;7 days old).</p>
      <button class="btn-danger"
              hx-post="/admin/actions/rebaseline-gmail"
              hx-target="#rebaseline-status"
              hx-swap="innerHTML"
              hx-confirm="Skip all unprocessed Gmail history and re-baseline?">Re-baseline</button>
      <span id="rebaseline-status" class="status"></span>
    </section>
  `
  return c.html(layout({ title: 'Actions', csrfToken, body, currentPath: '/admin/actions' }))
})

actionsRoutes.post('/run-brief', async (c) => {
  const form = await c.req.formData()
  const labelArg = String(form.get('brief-label') ?? 'morning')
  const label = (['morning', 'midday', 'evening'].includes(labelArg) ? labelArg : 'morning') as 'morning' | 'midday' | 'evening'

  const gmailRow = db.query('SELECT user_id FROM gmail_tokens LIMIT 1').get() as { user_id: string } | null
  const discordRow = db.query('SELECT user_id FROM discord_tokens LIMIT 1').get() as { user_id: string } | null
  if (!gmailRow || !discordRow) {
    return c.html(`<span class="status-err">Connect Gmail and Discord first.</span>`, 400)
  }

  try {
    await generateBrief({ gmailUserId: gmailRow.user_id, discordUserId: discordRow.user_id, label })
    return c.html(`<span class="status-ok">${esc(label)} brief queued.</span>`)
  } catch (err) {
    return c.html(`<span class="status-err">Failed: ${esc(String(err))}</span>`, 500)
  }
})

actionsRoutes.post('/rebaseline-gmail', async (c) => {
  const gmailRow = db.query('SELECT user_id, access_token, refresh_token, expires_at, scope FROM gmail_tokens LIMIT 1').get() as {
    user_id: string; access_token: string; refresh_token: string; expires_at: number; scope: string
  } | null
  if (!gmailRow) {
    return c.html(`<span class="status-err">No Gmail account connected.</span>`, 400)
  }
  try {
    const profile = await getProfile(gmailRow.access_token)
    saveGmailTokens({
      user_id: gmailRow.user_id,
      access_token: gmailRow.access_token,
      refresh_token: gmailRow.refresh_token,
      expires_at: gmailRow.expires_at,
      scope: gmailRow.scope,
      history_id: profile.historyId,
    })
    return c.html(`<span class="status-ok">Re-baselined to historyId ${esc(profile.historyId)}.</span>`)
  } catch (err) {
    return c.html(`<span class="status-err">Failed: ${esc(String(err))}</span>`, 500)
  }
})
