import { patchAttendees } from '../calendar/client'
import { getValidGmailAccessToken } from '../gmail/tokens'
import { createApproval, registerApprovalHandler, type Approval } from '../approvals/state'
import { insertEvent } from '../db/events'

export interface InviteAttendeesArgs {
  eventId: string
  emails: string[]
  eventTitle?: string
}

export async function requestInviteAttendees(
  args: InviteAttendeesArgs,
  ctx: { sessionId?: string | null } = {}
): Promise<string> {
  validateArgs(args)
  return createApproval({
    action: 'invite_attendees',
    payload: args,
    sessionId: ctx.sessionId ?? null,
  })
}

export function registerInviteAttendeesTool(gmailUserId: string): void {
  registerApprovalHandler('invite_attendees', async (payload: unknown, approval: Approval) => {
    const args = payload as InviteAttendeesArgs
    validateArgs(args)
    const accessToken = await getValidGmailAccessToken(gmailUserId)
    const event = await patchAttendees(accessToken, args.eventId, args.emails)
    insertEvent({
      sessionId: approval.session_id,
      type: 'tool:invite_attendees',
      payload: JSON.stringify({
        approval_id: approval.id,
        event_id: args.eventId,
        event_title: args.eventTitle,
        emails: args.emails,
      }),
      output: JSON.stringify({ success: true, attendee_count: event.attendees?.length ?? 0 }),
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
