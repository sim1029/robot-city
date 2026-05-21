import {
  approveApproval,
  getApproval,
  rejectApproval,
  updateApprovalPayload,
} from '../approvals/state'
import { runStage, buildFooter } from '../stages/runner'
import type { StageResult } from '../stages/types'
import { gatherForIntent } from '../stages/gather'
import { dispatchToolCall } from '../stages/act_dispatcher'
import { buildApprovalCardPayload, buildEditModal, buildResolvedCardPayload, type DiscordModal, parseApprovalCustomId } from './approval_card'
import { editChannelMessage, sendApprovalCardForApproval, sendThreadMessage, sendTypingIndicator } from './dm'
import { fetchThreadHistory } from './history'
import { getSetting } from '../db/settings'
import { isPaused } from '../system/pause'
import { computeSessionStats, ensureSession, getSessionCost, markSessionClosed } from '../db/sessions'
import { db } from '../db/client'
import { insertEvent } from '../db/events'
import type { ContentBlock, ToolDefinition } from '../providers/types'
import { formatCalendarList, listWritableCalendarsForUser } from '../calendar/defaults'
import {
  type DiscordMessageAttachment,
  resolveAudioInput,
  transcribeDiscordAudioAttachment,
} from './audio'

export { sendApprovalCardForApproval }

const FORUM_TOOLS: ToolDefinition[] = [
  {
    name: 'read_calendar',
    description: 'Fetch upcoming calendar events.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Start date YYYY-MM-DD, defaults to today' },
        days: { type: 'number', description: 'Number of days to look ahead, default 1' },
      },
    },
  },
  {
    name: 'read_email',
    description: 'Get emails triaged in the last 24 hours.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'create_calendar_event',
    description: 'Create a Google Calendar event. Executes immediately without approval.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start: { type: 'string', description: 'ISO8601 datetime' },
        end: { type: 'string', description: 'ISO8601 datetime' },
        description: { type: 'string' },
        location: { type: 'string' },
        calendarId: {
          type: 'string',
          description: 'Google Calendar ID to create the event on. Use this only when the user explicitly names a calendar from AVAILABLE CALENDARS.',
        },
      },
      required: ['title', 'start', 'end'],
    },
  },
  {
    name: 'invite_attendees',
    description: 'Invite attendees to a calendar event. Requires user approval.',
    input_schema: {
      type: 'object',
      properties: {
        eventId: { type: 'string' },
        emails: { type: 'array', items: { type: 'string' } },
        eventTitle: { type: 'string' },
        calendarId: {
          type: 'string',
          description: 'Google Calendar ID containing the event. Use the calendarId returned by create_calendar_event when inviting attendees to a newly-created non-primary calendar event.',
        },
      },
      required: ['eventId', 'emails'],
    },
  },
  {
    name: 'send_email',
    description: 'Send an email via Gmail. Requires user approval before sending.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
]

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

async function availableCalendarsContext(gmailUserId: string): Promise<string> {
  try {
    const calendars = await listWritableCalendarsForUser(gmailUserId)
    return [
      '[AVAILABLE CALENDARS]',
      'If the user explicitly names one of these calendars, pass its ID as create_calendar_event.calendarId. Otherwise omit calendarId and the saved default calendar will be used.',
      formatCalendarList(calendars),
    ].join('\n')
  } catch (err) {
    return `[AVAILABLE CALENDARS]\nUnable to list writable calendars. If calendar selection is needed, ask the owner to reconnect Google at /auth/google. Error: ${err instanceof Error ? err.message : String(err)}`
  }
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
  attachments?: DiscordMessageAttachment[]
}): Promise<void> {
  const sessionId = `discord:${args.threadId}`

  if (isPaused()) {
    await sendThreadMessage(
      args.threadId,
      '🛑 Assistant is paused. Re-enable it from the admin `/actions` page or with `/resume` in Discord.'
    )
    return
  }

  await sendTypingIndicator(args.threadId)

  const normalizedContent = await normalizeThreadMessageContent(args, sessionId)
  if (normalizedContent.kind === 'error') {
    await sendThreadMessage(args.threadId, normalizedContent.message)
    return
  }

  const gmailRow = db
    .query('SELECT user_id FROM gmail_tokens LIMIT 1')
    .get() as { user_id: string } | null
  const gmailUserId = gmailRow?.user_id ?? ''

  const history = await fetchThreadHistory(args.threadId, args.messageId).catch(() => [])

  const classifyResult = await runStage(
    'classify',
    INTERACTIVE_CLASSIFY_PROMPT(normalizedContent.content),
    sessionId
  )

  const gatherData = gmailUserId
    ? await gatherForIntent(classifyResult.text, gmailUserId).catch(() => '')
    : ''
  const calendarContext = gmailUserId
    ? await availableCalendarsContext(gmailUserId)
    : ''

  const dateHeader = currentDateHeader()

  const latestUserContent = [
    dateHeader,
    `[ORIGINAL MESSAGE]\n${normalizedContent.content}`,
    `[CLASSIFY]\n${classifyResult.text}`,
    gatherData ? `[CONTEXT]\n${gatherData}` : '',
    calendarContext,
  ].filter(Boolean).join('\n\n')

  // Agentic tool loop — reason stage calls tools natively; we execute and feed results back
  const MAX_TOOL_ITERS = 5
  const allStageResults: StageResult[] = [classifyResult]
  const reasonMessages: Array<{ role: 'user' | 'assistant'; content: string | ContentBlock[] }> = [
    ...history,
    { role: 'user', content: latestUserContent },
  ]

  let finalReasonText = ''
  let dispatchNote = ''

  for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
    const reasonResult = await runStage('reason', reasonMessages, sessionId, {
      tools: gmailUserId ? FORUM_TOOLS : undefined,
    })
    allStageResults.push(reasonResult)
    if (reasonResult.text) finalReasonText = reasonResult.text

    const toolCalls = reasonResult.toolCalls ?? []
    if (toolCalls.length === 0) break

    // Build the assistant message with text + tool_use blocks for the next turn
    const assistantContent: ContentBlock[] = []
    if (reasonResult.text) assistantContent.push({ type: 'text', text: reasonResult.text })
    for (const tc of toolCalls) {
      assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })
    }
    reasonMessages.push({ role: 'assistant', content: assistantContent })

    // Execute tools and collect results
    const toolResultBlocks: ContentBlock[] = []
    let shouldStop = false

    for (const tc of toolCalls) {
      const dispatch = await dispatchToolCall(tc.name, tc.input, {
        gmailUserId,
        discordUserId: args.userId,
        sessionId,
      })

      if (dispatch.kind === 'approval_pending') {
        dispatchNote = '\n\n_Sent you an approval request via DM._'
        toolResultBlocks.push({ type: 'tool_result', tool_use_id: tc.id, content: 'Action is pending user approval.' })
        shouldStop = true
        break
      }
      if (dispatch.kind === 'error') {
        dispatchNote = `\n\n_Action failed: ${dispatch.message}_`
        toolResultBlocks.push({ type: 'tool_result', tool_use_id: tc.id, content: `Error: ${dispatch.message}` })
        shouldStop = true
        break
      }
      toolResultBlocks.push({ type: 'tool_result', tool_use_id: tc.id, content: dispatch.output })
    }

    reasonMessages.push({ role: 'user', content: toolResultBlocks })
    if (shouldStop) break
  }

  const sessionCost = getSessionCost(sessionId)
  const footer = buildFooter(allStageResults, sessionCost)
  const reply = `${finalReasonText}${dispatchNote}\n\n${footer}`
  await sendThreadMessage(args.threadId, reply)
}

async function normalizeThreadMessageContent(
  args: {
    threadId: string
    messageId: string
    content: string
    attachments?: DiscordMessageAttachment[]
  },
  sessionId: string
): Promise<{ kind: 'ok'; content: string } | { kind: 'error'; message: string }> {
  const content = args.content.trim()
  const audioInput = resolveAudioInput(content, args.attachments ?? [])
  if (audioInput.kind === 'error') return { kind: 'error', message: audioInput.message }
  if (audioInput.kind === 'none') {
    if (!content) return { kind: 'error', message: 'Send a text message or one audio attachment for me to process.' }
    return { kind: 'ok', content }
  }

  try {
    const transcription = await transcribeDiscordAudioAttachment(audioInput.attachment)
    ensureSession(sessionId)
    insertEvent({
      sessionId,
      type: 'audio:transcription',
      model: transcription.model,
      latencyMs: transcription.latencyMs,
      payload: JSON.stringify({
        threadId: args.threadId,
        messageId: args.messageId,
        attachmentId: audioInput.attachment.id,
        filename: audioInput.attachment.name,
        contentType: audioInput.attachment.contentType,
        size: audioInput.attachment.size,
      }),
      output: transcription.text,
    })

    return {
      kind: 'ok',
      content: content
        ? `${content}\n\n[TRANSCRIBED AUDIO]\n${transcription.text}`
        : transcription.text,
    }
  } catch (err) {
    return {
      kind: 'error',
      message: `I couldn't transcribe that audio: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
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
