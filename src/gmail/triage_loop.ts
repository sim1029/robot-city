import { pollGmail } from './poll'
import { triageMessage } from '../workflows/inbox_triage'
import { requestSendEmail } from '../tools/send_email'
import { sendApprovalCardForApproval } from '../discord/handlers'
import { sendDm } from '../discord/dm'
import { isPaused } from '../system/pause'

export interface TriageTickInput {
  gmailUserId: string
  discordUserId: string
}

export interface TriageTickResult {
  pollKind: 'baselined' | 'synced' | 'gap-recovered' | 'paused'
  triaged: number
  notified: number
  approvalsRequested: number
}

export async function runTriageTick(input: TriageTickInput): Promise<TriageTickResult> {
  if (isPaused()) {
    return { pollKind: 'paused', triaged: 0, notified: 0, approvalsRequested: 0 }
  }
  const poll = await pollGmail(input.gmailUserId)
  let triaged = 0
  let notified = 0
  let approvalsRequested = 0

  const sessionId = `gmail:${input.gmailUserId}`

  for (const messageId of poll.newMessageIds) {
    const result = await triageMessage({
      userId: input.gmailUserId,
      messageId,
      sessionId,
    })
    triaged++

    if (!result.shouldNotify) continue
    notified++

    const summary = `**${result.classification.toUpperCase()}** — message ${messageId}\n${result.summary ?? ''}`
    await sendDm(input.discordUserId, { content: summary, components: [] })

    if (result.draft) {
      const approvalId = await requestSendEmail(
        { to: result.from, subject: replySubject(result.subject), body: result.draft },
        { sessionId }
      )
      await sendApprovalCardForApproval(approvalId, input.discordUserId)
      approvalsRequested++
    }
  }

  return {
    pollKind: poll.kind,
    triaged,
    notified,
    approvalsRequested,
  }
}

function replySubject(original: string): string {
  return /^re:\s/i.test(original) ? original : `Re: ${original}`
}
