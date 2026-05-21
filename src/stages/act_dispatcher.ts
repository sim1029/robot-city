import { createCalendarEvent } from '../tools/create_calendar_event'
import { requestInviteAttendees } from '../tools/invite_attendees'
import { requestSendEmail } from '../tools/send_email'
import { readCalendar } from '../tools/read_calendar'
import { sendApprovalCardForApproval } from '../discord/dm'
import { getValidGmailAccessToken } from '../gmail/tokens'
import { db } from '../db/client'
import { insertEvent } from '../db/events'

export type DispatchResult =
  | { kind: 'executed'; toolName: string; output: string }
  | { kind: 'approval_pending'; approvalId: string }
  | { kind: 'error'; message: string }

export async function dispatchToolCall(
  toolName: string,
  args: Record<string, unknown>,
  ctx: { gmailUserId: string; discordUserId: string; sessionId: string | null }
): Promise<DispatchResult> {
  console.log('[tool] dispatching %s args=%s', toolName, JSON.stringify(args))

  try {
    if (toolName === 'read_calendar') {
      const accessToken = await getValidGmailAccessToken(ctx.gmailUserId)
      const output = await readCalendar(accessToken, {
        date: args.date ? String(args.date) : undefined,
        days: args.days ? Number(args.days) : undefined,
      })
      console.log('[tool] read_calendar returned %d chars', output.length)
      logToolCall(ctx.sessionId, toolName, args, true)
      return { kind: 'executed', toolName, output }
    }

    if (toolName === 'read_email') {
      const since = Math.floor(Date.now() / 1000) - 86400
      const rows = db.query(
        `SELECT payload FROM events WHERE type = 'workflow:triage' AND created_at > ? ORDER BY created_at DESC LIMIT 10`
      ).all(since) as Array<{ payload: string }>
      if (rows.length === 0) {
        logToolCall(ctx.sessionId, toolName, args, true)
        return { kind: 'executed', toolName, output: 'No emails triaged in the last 24 hours.' }
      }
      const lines = rows.map(r => {
        try {
          const p = JSON.parse(r.payload) as { from?: string; subject?: string; classification?: string }
          return `• [${p.classification?.toUpperCase()}] ${p.subject ?? '(no subject)'} from ${p.from ?? 'unknown'}`
        } catch {
          return '• (unreadable)'
        }
      })
      logToolCall(ctx.sessionId, toolName, args, true)
      return { kind: 'executed', toolName, output: `Recent emails:\n${lines.join('\n')}` }
    }

    if (toolName === 'create_calendar_event') {
      const output = await createCalendarEvent(
        {
          title: String(args.title ?? ''),
          start: String(args.start ?? ''),
          end: String(args.end ?? ''),
          description: args.description ? String(args.description) : undefined,
          location: args.location ? String(args.location) : undefined,
          attendees: Array.isArray(args.attendees) ? (args.attendees as string[]) : undefined,
          calendarId: stringArg(args.calendarId ?? args.calendar_id),
        },
        { gmailUserId: ctx.gmailUserId, sessionId: ctx.sessionId }
      )
      console.log('[tool] create_calendar_event succeeded:', output)
      return { kind: 'executed', toolName, output }
    }

    if (toolName === 'invite_attendees') {
      const approvalId = await requestInviteAttendees(
        {
          eventId: String(args.eventId ?? ''),
          emails: Array.isArray(args.emails) ? (args.emails as string[]) : [],
          eventTitle: args.eventTitle ? String(args.eventTitle) : undefined,
          calendarId: stringArg(args.calendarId ?? args.calendar_id),
        },
        { sessionId: ctx.sessionId }
      )
      await sendApprovalCardForApproval(approvalId, ctx.discordUserId)
      console.log('[tool] invite_attendees approval created id=%s', approvalId)
      logToolCall(ctx.sessionId, toolName, args, true, 'approval_pending')
      return { kind: 'approval_pending', approvalId }
    }

    if (toolName === 'send_email') {
      const approvalId = await requestSendEmail(
        {
          to: String(args.to ?? ''),
          subject: String(args.subject ?? ''),
          body: String(args.body ?? ''),
        },
        { sessionId: ctx.sessionId }
      )
      await sendApprovalCardForApproval(approvalId, ctx.discordUserId)
      console.log('[tool] send_email approval created id=%s', approvalId)
      logToolCall(ctx.sessionId, toolName, args, true, 'approval_pending')
      return { kind: 'approval_pending', approvalId }
    }

    console.log('[tool] unknown tool:', toolName)
    logToolCall(ctx.sessionId, toolName, args, false)
    return { kind: 'error', message: `Unknown tool: ${toolName}` }
  } catch (err) {
    console.error('[tool] dispatch error for %s:', toolName, err)
    logToolCall(ctx.sessionId, toolName, args, false)
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}

function logToolCall(sessionId: string | null, toolName: string, args: Record<string, unknown>, success: boolean, result = 'executed'): void {
  insertEvent({
    sessionId,
    type: `tool:${toolName}:call`,
    payload: JSON.stringify(sanitizeToolInput(toolName, args)),
    output: JSON.stringify({ success, result }),
  })
}

function stringArg(value: unknown): string | undefined {
  return value == null || value === '' ? undefined : String(value)
}

function sanitizeToolInput(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  if (toolName === 'send_email') return { to: args.to, subject: args.subject }
  if (toolName === 'invite_attendees') return { eventId: args.eventId, eventTitle: args.eventTitle, emails: args.emails, calendarId: args.calendarId ?? args.calendar_id }
  if (toolName === 'create_calendar_event') return { title: args.title, start: args.start, end: args.end, location: args.location, attendees: args.attendees, calendarId: args.calendarId ?? args.calendar_id }
  if (toolName === 'read_calendar') return { date: args.date, days: args.days }
  return args
}
