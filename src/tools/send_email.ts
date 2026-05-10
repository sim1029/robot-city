import { db } from '../db/client'
import { sendMessage } from '../gmail/client'
import { getValidGmailAccessToken } from '../gmail/tokens'
import { createApproval, registerApprovalHandler, type Approval } from '../approvals/state'

export interface SendEmailArgs {
  to: string
  subject: string
  body: string
}

export interface SendEmailResult {
  id: string
  threadId: string
}

export async function requestSendEmail(
  args: SendEmailArgs,
  ctx: { sessionId?: string | null } = {}
): Promise<string> {
  validateArgs(args)
  return createApproval({
    action: 'send_email',
    payload: args,
    sessionId: ctx.sessionId ?? null,
  })
}

export function registerSendEmailTool(gmailUserId: string): void {
  registerApprovalHandler('send_email', async (payload: unknown, approval: Approval) => {
    const args = payload as SendEmailArgs
    validateArgs(args)
    const accessToken = await getValidGmailAccessToken(gmailUserId)
    const result = await sendMessage(accessToken, args)
    db.run(
      `INSERT INTO events (session_id, type, payload) VALUES (?, ?, ?)`,
      [
        approval.session_id,
        'tool:send_email',
        JSON.stringify({
          approval_id: approval.id,
          to: args.to,
          subject: args.subject,
          gmail_id: result.id,
          gmail_thread_id: result.threadId,
        }),
      ]
    )
    return result
  })
}

function validateArgs(args: SendEmailArgs): void {
  if (!args || typeof args !== 'object') throw new Error('send_email: args required')
  if (!args.to || !args.subject || !args.body) {
    throw new Error('send_email: to/subject/body all required')
  }
}
