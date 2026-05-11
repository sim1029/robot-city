import {
  approveApproval,
  getApproval,
  rejectApproval,
} from '../approvals/state'
import { runStage, buildFooter } from '../stages/runner'
import { gatherForIntent } from '../stages/gather'
import { dispatchAct } from '../stages/act_dispatcher'
import { buildResolvedCardPayload, parseApprovalCustomId } from './approval_card'
import { editChannelMessage, sendApprovalCardForApproval, sendThreadMessage, sendTypingIndicator } from './dm'
import { getSetting } from '../db/settings'
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

  await sendTypingIndicator(args.threadId)

  const gmailRow = db
    .query('SELECT user_id FROM gmail_tokens LIMIT 1')
    .get() as { user_id: string } | null
  const gmailUserId = gmailRow?.user_id ?? ''

  const classifyResult = await runStage(
    'classify',
    INTERACTIVE_CLASSIFY_PROMPT(args.content),
    sessionId
  )

  const gatherData = gmailUserId
    ? await gatherForIntent(classifyResult.text, gmailUserId).catch(() => '')
    : ''

  const dateHeader = currentDateHeader()

  const reasonPrompt = [
    dateHeader,
    `[ORIGINAL MESSAGE]\n${args.content}`,
    `[CLASSIFY]\n${classifyResult.text}`,
    gatherData ? `[CONTEXT]\n${gatherData}` : '',
  ].filter(Boolean).join('\n\n')

  const reasonResult = await runStage('reason', reasonPrompt, sessionId)

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

  const footer = buildFooter([classifyResult, reasonResult, actResult])
  const reply = `${reasonResult.text}${dispatchNote}\n\n${footer}`
  await sendThreadMessage(args.threadId, reply)
}
