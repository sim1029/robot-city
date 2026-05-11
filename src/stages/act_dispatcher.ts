import { createCalendarEvent } from '../tools/create_calendar_event'
import { requestInviteAttendees } from '../tools/invite_attendees'
import { requestSendEmail } from '../tools/send_email'
import { sendApprovalCardForApproval } from '../discord/dm'

export type DispatchResult =
  | { kind: 'none' }
  | { kind: 'executed'; output: string }
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
      return { kind: 'executed', output }
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
