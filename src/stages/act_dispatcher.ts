import { createCalendarEvent } from '../tools/create_calendar_event'
import { requestInviteAttendees } from '../tools/invite_attendees'
import { requestSendEmail } from '../tools/send_email'
import { readCalendar } from '../tools/read_calendar'
import { sendApprovalCardForApproval } from '../discord/dm'
import { getValidGmailAccessToken } from '../gmail/tokens'
import { db } from '../db/client'

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
      return { kind: 'executed', toolName, output }
    }

    if (toolName === 'read_email') {
      const since = Math.floor(Date.now() / 1000) - 86400
      const rows = db.query(
        `SELECT payload FROM events WHERE type = 'workflow:triage' AND created_at > ? ORDER BY created_at DESC LIMIT 10`
      ).all(since) as Array<{ payload: string }>
      if (rows.length === 0) {
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
        },
        { sessionId: ctx.sessionId }
      )
      await sendApprovalCardForApproval(approvalId, ctx.discordUserId)
      console.log('[tool] invite_attendees approval created id=%s', approvalId)
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
      return { kind: 'approval_pending', approvalId }
    }

    console.log('[tool] unknown tool:', toolName)
    return { kind: 'error', message: `Unknown tool: ${toolName}` }
  } catch (err) {
    console.error('[tool] dispatch error for %s:', toolName, err)
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}
