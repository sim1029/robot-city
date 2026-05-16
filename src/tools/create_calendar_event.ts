import { createEvent } from '../calendar/client'
import { getValidGmailAccessToken } from '../gmail/tokens'
import { getSetting } from '../db/settings'
import { insertEvent } from '../db/events'

export interface CreateEventArgs {
  title: string
  start: string
  end: string
  description?: string
  location?: string
  attendees?: string[]
}

export async function createCalendarEvent(
  args: CreateEventArgs,
  ctx: { gmailUserId: string; sessionId?: string | null }
): Promise<string> {
  validateArgs(args)
  const accessToken = await getValidGmailAccessToken(ctx.gmailUserId)
  const timezone = getSetting('timezone', 'UTC')

  const event = await createEvent(accessToken, {
    summary: args.title,
    start: { dateTime: withOffset(args.start, timezone), timeZone: timezone },
    end: { dateTime: withOffset(args.end, timezone), timeZone: timezone },
    description: args.description,
    location: args.location,
    attendees: args.attendees?.map(email => ({ email })),
  })

  insertEvent({
    sessionId: ctx.sessionId ?? null,
    type: 'tool:create_calendar_event',
    payload: JSON.stringify({ title: args.title, start: args.start, end: args.end, attendees: args.attendees ?? [] }),
    output: JSON.stringify({ success: true, event_id: event.id }),
  })

  const dateStr = formatEventDate(args.start)
  return `Created event: **${args.title}** on ${dateStr}${event.htmlLink ? ` — [view in Google Calendar](${event.htmlLink})` : ''}`
}

function validateArgs(args: CreateEventArgs): void {
  if (!args?.title) throw new Error('create_calendar_event: title required')
  if (!args.start) throw new Error('create_calendar_event: start (ISO8601) required')
  if (!args.end) throw new Error('create_calendar_event: end (ISO8601) required')
}

function formatEventDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}

// Google Calendar interprets naive `dateTime` strings (no offset) inconsistently when only
// `timeZone` is supplied — events land 1 hour off across DST boundaries. Append a DST-aware
// offset computed from the event's own date so the wire payload is unambiguous RFC 3339.
export function withOffset(localIso: string, timeZone: string): string {
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(localIso)) return localIso
  const utc = new Date(`${localIso}Z`)
  if (isNaN(utc.getTime())) return localIso
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(utc)
  const name = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT'
  const offset = name.replace('GMT', '') || '+00:00'
  return `${localIso}${offset}`
}
