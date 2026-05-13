import { db } from '../db/client'
import { getValidGmailAccessToken } from '../gmail/tokens'
import { readCalendar } from '../tools/read_calendar'
import { runStage } from '../stages/runner'
import { openDmChannel, sendThreadMessage, sendTypingIndicator } from '../discord/dm'

export type BriefLabel = 'morning' | 'midday' | 'evening'

export interface BriefOpts {
  gmailUserId: string
  discordUserId: string
  label: BriefLabel
}

const BRIEF_SYSTEM_PROMPTS: Record<BriefLabel, string> = {
  morning: 'You are a concise AI concierge composing a morning brief. Cover the user\'s calendar for today and highlight any important recent emails. Be friendly, brief, and actionable. Use Discord markdown (bold for event names, bullet points). Keep under 400 words.',
  midday: 'You are a concise AI concierge composing a midday check-in. Highlight remaining calendar events today and any urgent emails. Use Discord markdown. Keep under 300 words.',
  evening: 'You are a concise AI concierge composing an evening wrap-up. Summarize what was on the calendar today and any unresolved emails. Use Discord markdown. Keep under 300 words.',
}

export async function generateBrief(opts: BriefOpts): Promise<void> {
  const accessToken = await getValidGmailAccessToken(opts.gmailUserId)
  const calendarData = await readCalendar(accessToken, { days: 1 }).catch(
    (err: unknown) => `Unable to fetch calendar: ${err instanceof Error ? err.message : String(err)}`
  )

  const since = Math.floor(Date.now() / 1000) - 86400
  const triageRows = db.query(
    `SELECT payload FROM events WHERE type = 'workflow:triage' AND created_at > ? ORDER BY created_at DESC LIMIT 10`
  ).all(since) as Array<{ payload: string }>

  const emailLines = triageRows
    .map(r => {
      try {
        const p = JSON.parse(r.payload) as { from?: string; subject?: string; classification?: string }
        if (p.classification === 'ignore') return null
        return `• [${p.classification?.toUpperCase()}] ${p.subject ?? '(no subject)'} from ${p.from ?? 'unknown'}`
      } catch {
        return null
      }
    })
    .filter(Boolean)

  const emailData = emailLines.length > 0
    ? emailLines.join('\n')
    : 'No notable emails in the last 24 hours.'

  const briefPrompt = `[TODAY'S CALENDAR]\n${calendarData}\n\n[RECENT EMAILS]\n${emailData}`

  const dmChannelId = await openDmChannel(opts.discordUserId)
  await sendTypingIndicator(dmChannelId)
  const typingInterval = setInterval(() => { sendTypingIndicator(dmChannelId).catch(() => {}) }, 8000)

  let result: Awaited<ReturnType<typeof runStage>>
  try {
    result = await runStage('reason', briefPrompt, null, {
      systemPrompt: BRIEF_SYSTEM_PROMPTS[opts.label],
      maxOutputTokens: 600,
    })
  } finally {
    clearInterval(typingInterval)
  }

  const label = opts.label.charAt(0).toUpperCase() + opts.label.slice(1)
  const content = `**${label} Brief**\n\n${result.text}`

  await sendThreadMessage(dmChannelId, content)

  db.run(
    `INSERT INTO events (session_id, type, model, input_tokens, output_tokens, cost_usd, latency_ms, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      null,
      'workflow:brief',
      result.model,
      result.inputTokens,
      result.outputTokens,
      result.costUsd,
      result.latencyMs,
      JSON.stringify({ label: opts.label, cost_usd: result.costUsd }),
    ]
  )
}
