import { db } from '../db/client'
import { getValidGmailAccessToken } from '../gmail/tokens'
import { readCalendar } from '../tools/read_calendar'

export async function gatherForIntent(classifyText: string, gmailUserId: string): Promise<string> {
  const upper = classifyText.toUpperCase()

  if (upper.includes('READ_CALENDAR') || upper.includes('CREATE_CALENDAR_EVENT') || upper.includes('INVITE_ATTENDEES')) {
    try {
      const accessToken = await getValidGmailAccessToken(gmailUserId)
      const events = await readCalendar(accessToken, { days: 1 })
      return `[TODAY'S CALENDAR]\n${events}`
    } catch (err) {
      return `[TODAY'S CALENDAR]\nUnable to fetch calendar: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  if (upper.includes('READ_EMAIL')) {
    const since = Math.floor(Date.now() / 1000) - 86400
    const rows = db.query(
      `SELECT payload FROM events WHERE type = 'workflow:triage' AND created_at > ? ORDER BY created_at DESC LIMIT 10`
    ).all(since) as Array<{ payload: string }>

    if (rows.length === 0) return '[RECENT EMAILS]\nNo emails triaged in the last 24 hours.'

    const lines = rows.map(r => {
      try {
        const p = JSON.parse(r.payload) as { from?: string; subject?: string; classification?: string }
        return `• [${p.classification?.toUpperCase()}] ${p.subject ?? '(no subject)'} from ${p.from ?? 'unknown'}`
      } catch {
        return '• (unreadable)'
      }
    })
    return `[RECENT EMAILS]\n${lines.join('\n')}`
  }

  return ''
}
