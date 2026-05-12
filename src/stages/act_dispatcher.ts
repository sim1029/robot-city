import { createCalendarEvent } from '../tools/create_calendar_event'
import { requestInviteAttendees } from '../tools/invite_attendees'
import { requestSendEmail } from '../tools/send_email'
import { readCalendar } from '../tools/read_calendar'
import { sendApprovalCardForApproval } from '../discord/dm'
import { getValidGmailAccessToken } from '../gmail/tokens'
import { db } from '../db/client'

export type DispatchResult =
  | { kind: 'none' }
  | { kind: 'executed'; toolName: string; output: string }
  | { kind: 'approval_pending'; approvalId: string }
  | { kind: 'error'; message: string }

interface ActPayload {
  tool: string
  args?: Record<string, unknown>
}

export async function dispatchAct(
  actText: string,
  ctx: { gmailUserId: string; discordUserId: string; sessionId: string | null }
): Promise<DispatchResult> {
  console.log('[act] raw output:', actText)

  let parsed: ActPayload
  try {
    const jsonMatch = actText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.log('[act] no JSON found in output, skipping dispatch')
      return { kind: 'none' }
    }
    parsed = JSON.parse(jsonMatch[0]) as ActPayload
    console.log('[act] parsed tool=%s args=%s', parsed.tool, JSON.stringify(parsed.args ?? {}))
  } catch (err) {
    console.log('[act] JSON parse failed:', err)
    return { kind: 'none' }
  }

  const { tool, args = {} } = parsed
  if (!tool || tool === 'none') {
    console.log('[act] tool=none, no dispatch')
    return { kind: 'none' }
  }

  try {
    if (tool === 'read_calendar') {
      console.log('[act] dispatching read_calendar for gmailUser=%s', ctx.gmailUserId)
      const accessToken = await getValidGmailAccessToken(ctx.gmailUserId)
      const output = await readCalendar(accessToken, {
        date: args.date ? String(args.date) : undefined,
        days: args.days ? Number(args.days) : undefined,
      })
      console.log('[act] read_calendar returned %d chars', output.length)
      return { kind: 'executed', toolName: 'read_calendar', output }
    }

    if (tool === 'read_email') {
      console.log('[act] dispatching read_email')
      const since = Math.floor(Date.now() / 1000) - 86400
      const rows = db.query(
        `SELECT payload FROM events WHERE type = 'workflow:triage' AND created_at > ? ORDER BY created_at DESC LIMIT 10`
      ).all(since) as Array<{ payload: string }>
      if (rows.length === 0) {
        return { kind: 'executed', toolName: 'read_email', output: 'No emails triaged in the last 24 hours.' }
      }
      const lines = rows.map(r => {
        try {
          const p = JSON.parse(r.payload) as { from?: string; subject?: string; classification?: string }
          return `• [${p.classification?.toUpperCase()}] ${p.subject ?? '(no subject)'} from ${p.from ?? 'unknown'}`
        } catch {
          return '• (unreadable)'
        }
      })
      return { kind: 'executed', toolName: 'read_email', output: `Recent emails:\n${lines.join('\n')}` }
    }

    if (tool === 'create_calendar_event') {
      console.log('[act] dispatching create_calendar_event for gmailUser=%s', ctx.gmailUserId)
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
      console.log('[act] create_calendar_event succeeded:', output)
      return { kind: 'executed', toolName: 'create_calendar_event', output }
    }

    if (tool === 'invite_attendees') {
      console.log('[act] dispatching invite_attendees eventId=%s', args.eventId)
      const approvalId = await requestInviteAttendees(
        {
          eventId: String(args.eventId ?? ''),
          emails: Array.isArray(args.emails) ? (args.emails as string[]) : [],
          eventTitle: args.eventTitle ? String(args.eventTitle) : undefined,
        },
        { sessionId: ctx.sessionId }
      )
      await sendApprovalCardForApproval(approvalId, ctx.discordUserId)
      console.log('[act] invite_attendees approval created id=%s', approvalId)
      return { kind: 'approval_pending', approvalId }
    }

    if (tool === 'send_email') {
      console.log('[act] dispatching send_email to=%s', args.to)
      const approvalId = await requestSendEmail(
        {
          to: String(args.to ?? ''),
          subject: String(args.subject ?? ''),
          body: String(args.body ?? ''),
        },
        { sessionId: ctx.sessionId }
      )
      await sendApprovalCardForApproval(approvalId, ctx.discordUserId)
      console.log('[act] send_email approval created id=%s', approvalId)
      return { kind: 'approval_pending', approvalId }
    }

    console.log('[act] unknown tool:', tool)
    return { kind: 'error', message: `Unknown tool: ${tool}` }
  } catch (err) {
    console.error('[act] dispatch error for tool=%s:', tool, err)
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}
