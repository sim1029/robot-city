import {
  approveApproval,
  getApproval,
  rejectApproval,
  setApprovalDiscordMessage,
} from '../approvals/state'
import { runPipeline } from '../stages/runner'
import { buildApprovalCardPayload, buildResolvedCardPayload, parseApprovalCustomId } from './approval_card'
import { editChannelMessage, sendDm, sendThreadMessage } from './dm'

export async function sendApprovalCardForApproval(approvalId: string, discordUserId: string): Promise<void> {
  const approval = getApproval(approvalId)
  if (!approval) throw new Error(`Approval ${approvalId} not found`)
  const payload = buildApprovalCardPayload(approval)
  const ref = await sendDm(discordUserId, payload)
  setApprovalDiscordMessage(approvalId, ref.messageId)
}

export type InteractionOutcome =
  | { kind: 'ignored' }
  | { kind: 'stale'; status: string }
  | { kind: 'resolved'; decision: 'approve' | 'reject' }

export async function handleApprovalInteraction(args: {
  customId: string
  interactionChannelId: string
}): Promise<InteractionOutcome> {
  const parsed = parseApprovalCustomId(args.customId)
  if (!parsed) return { kind: 'ignored' }

  const approval = getApproval(parsed.id)
  if (!approval) return { kind: 'stale', status: 'missing' }
  if (approval.status !== 'pending') return { kind: 'stale', status: approval.status }

  if (parsed.decision === 'approve') {
    await approveApproval(approval.id)
  } else {
    await rejectApproval(approval.id, 'user cancelled via Discord')
  }

  const updated = getApproval(approval.id)!
  const messageId = updated.discord_message_id
  if (messageId) {
    const resolvedDecision = parsed.decision === 'approve' ? 'approved' : 'rejected'
    await editChannelMessage(
      args.interactionChannelId,
      messageId,
      buildResolvedCardPayload(updated, resolvedDecision)
    )
  }
  return { kind: 'resolved', decision: parsed.decision }
}

export async function handleThreadMessage(args: {
  threadId: string
  userId: string
  content: string
}): Promise<void> {
  const sessionId = `discord:${args.threadId}`
  const result = await runPipeline(args.content, sessionId, ['classify', 'reason'])
  const reasonStage = result.stages.at(-1)
  const reply = `${reasonStage?.text ?? ''}\n\n${result.footer}`
  await sendThreadMessage(args.threadId, reply)
}
