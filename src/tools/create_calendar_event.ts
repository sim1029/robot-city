import { db } from '../db/client'
import { createEvent } from '../calendar/client'
import { getValidGmailAccessToken } from '../gmail/tokens'
import { getSetting } from '../db/settings'

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
    start: { dateTime: args.start, timeZone: timezone },
    end: { dateTime: args.end, timeZone: timezone },
    description: args.description,
    location: args.location,
    attendees: args.attendees?.map(email => ({ email })),
  })

  db.run(
    `INSERT INTO events (session_id, type, payload) VALUES (?, ?, ?)`,
    [
      ctx.sessionId ?? null,
      'tool:create_calendar_event',
      JSON.stringify({ event_id: event.id, title: args.title, start: args.start }),
    ]
  )

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
