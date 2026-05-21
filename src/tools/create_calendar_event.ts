import { createEvent, listCalendars } from '../calendar/client'
import { getValidGmailAccessToken } from '../gmail/tokens'
import { getSetting } from '../db/settings'
import { getDefaultCalendarId, PRIMARY_CALENDAR_ID } from '../calendar/defaults'
import { insertEvent } from '../db/events'

export interface CreateEventArgs {
  title: string
  start: string
  end: string
  description?: string
  location?: string
  attendees?: string[]
  calendarId?: string
  calendar_id?: string
}

export async function createCalendarEvent(
  args: CreateEventArgs,
  ctx: { gmailUserId: string; sessionId?: string | null }
): Promise<string> {
  validateArgs(args)
  const accessToken = await getValidGmailAccessToken(ctx.gmailUserId)
  const calendarId = requestedCalendarId(args) || getDefaultCalendarId()
  const timezone = await resolveCalendarTimezone(accessToken, calendarId, getSetting('timezone', 'UTC'))

  const event = await createEvent(accessToken, {
    summary: args.title,
    start: { dateTime: withOffset(args.start, timezone), timeZone: timezone },
    end: { dateTime: withOffset(args.end, timezone), timeZone: timezone },
    description: args.description,
    location: args.location,
    attendees: args.attendees?.map(email => ({ email })),
  }, { calendarId })

  insertEvent({
    sessionId: ctx.sessionId ?? null,
    type: 'tool:create_calendar_event',
    payload: JSON.stringify({
      title: args.title,
      start: args.start,
      end: args.end,
      attendees: args.attendees ?? [],
      calendar_id: calendarId,
    }),
    output: JSON.stringify({ success: true, event_id: event.id, calendar_id: calendarId }),
  })

  const dateStr = formatEventDate(args.start)
  const calendarNote = calendarId !== PRIMARY_CALENDAR_ID ? ` on calendar \`${calendarId}\`` : ''
  return `Created event: **${args.title}** on ${dateStr}${calendarNote}${event.htmlLink ? ` — [view in Google Calendar](${event.htmlLink})` : ''}`
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

function requestedCalendarId(args: CreateEventArgs): string | undefined {
  return args.calendarId?.trim() || args.calendar_id?.trim() || undefined
}

// Google Calendar interprets naive `dateTime` strings (no offset) inconsistently when only
// `timeZone` is supplied - events land 1 hour off across DST boundaries. Append a DST-aware
// offset computed from the wall time so the wire payload is unambiguous RFC 3339.
//
// We need the offset that applies to the intended local wall time, not to the instant
// you get by reinterpreting that string as UTC. On a DST transition day those two instants
// straddle the boundary, so a single lookup picks the wrong offset. One iteration fixes it:
// use the first offset to back out a corrected UTC instant, then re-query.
export function withOffset(localIso: string, timeZone: string): string {
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(localIso)) return localIso
  const asUtcMs = new Date(`${localIso}Z`).getTime()
  if (isNaN(asUtcMs)) return localIso
  const guess = offsetMsAt(asUtcMs, timeZone)
  const resolved = offsetMsAt(asUtcMs - guess, timeZone)
  return `${localIso}${formatOffset(resolved)}`
}

async function resolveCalendarTimezone(accessToken: string, calendarId: string, fallback: string): Promise<string> {
  try {
    const calendars = await listCalendars(accessToken)
    const calendar = calendarId === PRIMARY_CALENDAR_ID
      ? calendars.find(c => c.primary) ?? calendars.find(c => c.id === PRIMARY_CALENDAR_ID)
      : calendars.find(c => c.id === calendarId)
    return calendar?.timeZone || fallback
  } catch {
    return fallback
  }
}

function offsetMsAt(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(new Date(instantMs))
  const name = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT'
  const raw = name.replace('GMT', '') || '+00:00'
  const m = /([+-])(\d{2}):?(\d{2})/.exec(raw)
  if (!m) return 0
  const sign = m[1] === '+' ? 1 : -1
  return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) * 60_000
}

function formatOffset(ms: number): string {
  const sign = ms < 0 ? '-' : '+'
  const abs = Math.abs(ms)
  const hh = String(Math.floor(abs / 3_600_000)).padStart(2, '0')
  const mm = String(Math.floor((abs % 3_600_000) / 60_000)).padStart(2, '0')
  return `${sign}${hh}:${mm}`
}
