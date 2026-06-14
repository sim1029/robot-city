import { patchAttendees } from '../calendar/client'
import { getValidGmailAccessToken } from '../gmail/tokens'
import { createApproval, registerApprovalHandler, type Approval } from '../approvals/state'
import { and, desc, eq } from 'drizzle-orm'
import { insertEvent } from '../db/events'
import { db } from '../db/client'
import { events } from '../db/tables'

export interface InviteAttendeesArgs {
  eventId: string
  emails: string[]
  eventTitle?: string
  calendarId?: string
}

export async function requestInviteAttendees(
  args: InviteAttendeesArgs,
  ctx: { sessionId?: string | null } = {}
): Promise<string> {
  validateArgs(args)
  const calendarId = args.calendarId?.trim() || findCreatedEventCalendarId(args.eventId, ctx.sessionId)
  return createApproval({
    action: 'invite_attendees',
    payload: { ...args, calendarId },
    sessionId: ctx.sessionId ?? null,
  })
}

export function registerInviteAttendeesTool(gmailUserId: string): void {
  registerApprovalHandler('invite_attendees', async (payload: unknown, approval: Approval) => {
    const args = payload as InviteAttendeesArgs
    validateArgs(args)
    const accessToken = await getValidGmailAccessToken(gmailUserId)
    const calendarId = args.calendarId?.trim() || 'primary'
    const event = await patchAttendees(accessToken, args.eventId, args.emails, { calendarId })
    insertEvent({
      sessionId: approval.session_id,
      type: 'tool:invite_attendees',
      payload: JSON.stringify({
        approval_id: approval.id,
        event_id: args.eventId,
        event_title: args.eventTitle,
        calendar_id: calendarId,
        emails: args.emails,
      }),
      output: JSON.stringify({ success: true, attendee_count: event.attendees?.length ?? 0, calendar_id: calendarId }),
    })
    return { eventId: event.id, attendees: event.attendees?.map(a => a.email) }
  })
}

function validateArgs(args: InviteAttendeesArgs): void {
  if (!args?.eventId) throw new Error('invite_attendees: eventId required')
  if (!Array.isArray(args.emails) || args.emails.length === 0) {
    throw new Error('invite_attendees: emails (non-empty array) required')
  }
}

function findCreatedEventCalendarId(eventId: string, sessionId?: string | null): string | undefined {
  if (!sessionId) return undefined

  const rows = db.select({ payload: events.payload, output: events.output })
    .from(events)
    .where(and(eq(events.sessionId, sessionId), eq(events.type, 'tool:create_calendar_event')))
    .orderBy(desc(events.id))
    .limit(25)
    .all()

  for (const row of rows) {
    const output = parseJson(row.output)
    const payload = parseJson(row.payload)
    const loggedEventId = stringValue(output.event_id) ?? stringValue(payload.event_id)
    if (loggedEventId === eventId) {
      return stringValue(output.calendar_id) ?? stringValue(payload.calendar_id)
    }
  }

  return undefined
}

function parseJson(value: string | null): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}
