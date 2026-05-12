import { db } from '../db/client'
import { getValidGmailAccessToken } from '../gmail/tokens'
import { readCalendar } from '../tools/read_calendar'
import { lookupContacts } from '../contacts/client'

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

  if (upper.includes('SEND_EMAIL')) {
    const hint = extractRecipientHint(classifyText)
    if (hint) {
      const candidates = lookupContacts(hint, 5)
      if (candidates.length > 0) {
        const list = candidates
          .map(c => `• ${c.name || c.email} <${c.email}>`)
          .join('\n')
        return `[CONTACTS - matches for "${hint}"]\n${list}`
      }
    }
    return '[CONTACTS]\nNo matching contacts found. Ask the user for the recipient\'s email address.'
  }

  return ''
}

// Pull the most likely recipient name out of a classify-stage output string.
// Classify text looks like: "SEND_EMAIL: User wants to send an email to Bob Smith about..."
function extractRecipientHint(classifyText: string): string {
  // Match words immediately after "to" that start with capitals (person names)
  const toMatch = classifyText.match(/\bto\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/i)
  if (toMatch) return toMatch[1].trim()

  // Fallback: any run of capitalized words not at sentence start
  const caps = classifyText.match(/(?<!\.\s{0,3})[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g)
  if (caps && caps.length > 0) return caps[0]

  return ''
}
