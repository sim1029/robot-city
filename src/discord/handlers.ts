import {
  approveApproval,
  getApproval,
  rejectApproval,
  updateApprovalPayload,
} from '../approvals/state'
import { runStage, buildFooter } from '../stages/runner'
import { gatherForIntent } from '../stages/gather'
import { dispatchAct } from '../stages/act_dispatcher'
import { buildApprovalCardPayload, buildEditModal, buildResolvedCardPayload, type DiscordModal, parseApprovalCustomId } from './approval_card'
import { editChannelMessage, sendApprovalCardForApproval, sendThreadMessage, sendTypingIndicator } from './dm'
import { fetchThreadHistory, type ThreadHistoryMessage } from './history'
import { getSetting } from '../db/settings'
import { computeSessionStats, getSessionCost, markSessionClosed } from '../db/sessions'
import { db } from '../db/client'

export { sendApprovalCardForApproval }

const INTERACTIVE_CLASSIFY_PROMPT = (content: string) =>
  `Classify the user intent. Output exactly one label on the first line, then one sentence reason.
Labels: READ_CALENDAR, CREATE_CALENDAR_EVENT, INVITE_ATTENDEES, READ_EMAIL, SEND_EMAIL, CONVERSATION

User message: ${content}`

function currentDateHeader(): string {
  const timezone = getSetting('timezone', 'UTC')
  const now = new Date()
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(now)
  return `[CURRENT DATE AND TIME]\n${formatted}`
}

export type InteractionOutcome =
  | { kind: 'ignored' }
  | { kind: 'stale'; status: string }
  | { kind: 'resolved'; decision: 'approve' | 'reject' }
  | { kind: 'show_modal'; modal: DiscordModal }

export type EditModalOutcome =
  | { kind: 'ignored' }
  | { kind: 'stale'; status: string }
  | { kind: 'edited' }

export async function handleApprovalInteraction(args: {
  customId: string
  interactionChannelId: string
}): Promise<InteractionOutcome> {
  const parsed = parseApprovalCustomId(args.customId)
  if (!parsed) return { kind: 'ignored' }

  const approval = getApproval(parsed.id)
  if (!approval) return { kind: 'stale', status: 'missing' }
  if (approval.status !== 'pending') return { kind: 'stale', status: approval.status }

  if (parsed.decision === 'edit') {
    return { kind: 'show_modal', modal: buildEditModal(approval) }
  }

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

export async function handleEditModalSubmit(args: {
  customId: string
  fields: { subject: string; body: string }
  interactionChannelId: string
}): Promise<EditModalOutcome> {
  const parts = args.customId.split(':')
  if (parts.length !== 3 || parts[0] !== 'approval' || parts[2] !== 'edit_submit') {
    return { kind: 'ignored' }
  }
  const approvalId = parts[1]

  const approval = getApproval(approvalId)
  if (!approval) return { kind: 'stale', status: 'missing' }
  if (approval.status !== 'pending') return { kind: 'stale', status: approval.status }

  updateApprovalPayload(approvalId, { subject: args.fields.subject, body: args.fields.body })

  const updated = getApproval(approvalId)!
  const messageId = updated.discord_message_id
  if (messageId) {
    await editChannelMessage(
      args.interactionChannelId,
      messageId,
      buildApprovalCardPayload(updated)
    )
  }
  return { kind: 'edited' }
}

export async function handleThreadMessage(args: {
  threadId: string
  userId: string
  messageId: string
  content: string
}): Promise<void> {
  const sessionId = `discord:${args.threadId}`

  await sendTypingIndicator(args.threadId)

  const gmailRow = db
    .query('SELECT user_id FROM gmail_tokens LIMIT 1')
    .get() as { user_id: string } | null
  const gmailUserId = gmailRow?.user_id ?? ''

  const history = await fetchThreadHistory(args.threadId, args.messageId).catch(() => [] as ThreadHistoryMessage[])

  const classifyResult = await runStage(
    'classify',
    INTERACTIVE_CLASSIFY_PROMPT(args.content),
    sessionId
  )

  const gatherData = gmailUserId
    ? await gatherForIntent(classifyResult.text, gmailUserId).catch(() => '')
    : ''

  const dateHeader = currentDateHeader()

  const latestUserContent = [
    dateHeader,
    `[ORIGINAL MESSAGE]\n${args.content}`,
    `[CLASSIFY]\n${classifyResult.text}`,
    gatherData ? `[CONTEXT]\n${gatherData}` : '',
  ].filter(Boolean).join('\n\n')

  const reasonMessages: ThreadHistoryMessage[] = [
    ...history,
    { role: 'user', content: latestUserContent },
  ]

  const reasonResult = await runStage('reason', reasonMessages, sessionId)

  const actPrompt = [
    dateHeader,
    `[ORIGINAL MESSAGE]\n${args.content}`,
    `[REASON]\n${reasonResult.text}`,
  ].join('\n\n')

  const actResult = await runStage('act', actPrompt, sessionId)

  let dispatchNote = ''
  if (gmailUserId) {
    const dispatch = await dispatchAct(actResult.text, {
      gmailUserId,
      discordUserId: args.userId,
      sessionId,
    })

    if (dispatch.kind === 'executed') {
      dispatchNote = `\n\n${dispatch.output}`
    } else if (dispatch.kind === 'approval_pending') {
      dispatchNote = '\n\n_Sent you an approval request via DM._'
    } else if (dispatch.kind === 'error') {
      dispatchNote = `\n\n_Action failed: ${dispatch.message}_`
    }
  }

  const sessionCost = getSessionCost(sessionId)
  const footer = buildFooter([classifyResult, reasonResult, actResult], sessionCost)
  const reply = `${reasonResult.text}${dispatchNote}\n\n${footer}`
  await sendThreadMessage(args.threadId, reply)
}

export async function handleThreadArchive(args: { threadId: string }): Promise<void> {
  const sessionId = `discord:${args.threadId}`
  const stats = computeSessionStats(sessionId)
  if (!stats) return
  if (stats.closedAt) return

  const summary = formatSessionSummary(stats)
  await sendThreadMessage(args.threadId, summary)
  markSessionClosed(sessionId)
}

function formatSessionSummary(stats: ReturnType<typeof computeSessionStats> & {}): string {
  const msgWord = stats.messageCount === 1 ? 'message' : 'messages'
  const toolWord = stats.toolCount === 1 ? 'tool call' : 'tool calls'
  return [
    '**Session closed**',
    '─────────────────────────────────',
    `$${stats.totalCostUsd.toFixed(4)} total  •  ${stats.messageCount} ${msgWord}  •  ${stats.toolCount} ${toolWord}`,
    `↑ ${stats.totalInputTokens.toLocaleString()} in  ↓ ${stats.totalOutputTokens.toLocaleString()} out`,
  ].join('\n')
}
