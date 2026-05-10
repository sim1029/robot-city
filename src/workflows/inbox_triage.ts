import { db } from '../db/client'
import { getMessage } from '../gmail/client'
import { getValidGmailAccessToken } from '../gmail/tokens'
import { runStage } from '../stages/runner'

export type TriageClassification = 'ignore' | 'respond' | 'urgent'

export interface TriageInput {
  userId: string
  messageId: string
  sessionId: string | null
}

export interface TriageResult {
  messageId: string
  classification: TriageClassification
  shouldNotify: boolean
  from: string
  subject: string
  summary?: string
  draft?: string
  costUsd: number
}

const CLASSIFY_PROMPT = (subject: string, from: string, snippet: string) =>
  `Classify this email by required action. Output exactly one of: IGNORE, RESPOND, URGENT, on its own line, then a one-sentence reason.

From: ${from}
Subject: ${subject}
Snippet: ${snippet}`

const REASON_PROMPT = (subject: string, from: string, snippet: string, classification: TriageClassification) =>
  `An incoming email is classified as ${classification.toUpperCase()}. Produce a short response plan, then a draft reply on a new line after "DRAFT:".

From: ${from}
Subject: ${subject}
Snippet: ${snippet}`

export async function triageMessage(input: TriageInput): Promise<TriageResult> {
  const accessToken = await getValidGmailAccessToken(input.userId)
  const message = await getMessage(accessToken, input.messageId)

  const from = message.headers.from ?? '(unknown)'
  const subject = message.headers.subject ?? '(no subject)'
  const snippet = message.snippet

  const classifyResult = await runStage(
    'classify',
    CLASSIFY_PROMPT(subject, from, snippet),
    input.sessionId
  )
  const classification = parseClassification(classifyResult.text)
  let costUsd = classifyResult.costUsd

  let summary: string | undefined
  let draft: string | undefined
  if (classification !== 'ignore') {
    const reasonResult = await runStage(
      'reason',
      REASON_PROMPT(subject, from, snippet, classification),
      input.sessionId
    )
    costUsd += reasonResult.costUsd
    const split = splitDraft(reasonResult.text)
    summary = split.plan
    draft = split.draft
  }

  db.run(
    `INSERT INTO events (session_id, type, payload) VALUES (?, ?, ?)`,
    [
      input.sessionId,
      'workflow:triage',
      JSON.stringify({
        message_id: input.messageId,
        from,
        subject,
        classification,
        cost_usd: costUsd,
      }),
    ]
  )

  return {
    messageId: input.messageId,
    classification,
    shouldNotify: classification !== 'ignore',
    from,
    subject,
    summary,
    draft,
    costUsd,
  }
}

function parseClassification(text: string): TriageClassification {
  const firstLine = text.trim().split(/\r?\n/)[0].toUpperCase()
  if (firstLine.includes('IGNORE')) return 'ignore'
  if (firstLine.includes('URGENT')) return 'urgent'
  if (firstLine.includes('RESPOND')) return 'respond'
  return 'respond'
}

function splitDraft(text: string): { plan: string; draft?: string } {
  const idx = text.indexOf('DRAFT:')
  if (idx === -1) return { plan: text.trim() }
  const plan = text.slice(0, idx).trim()
  const draft = text.slice(idx + 'DRAFT:'.length).trim()
  return { plan, draft: draft || undefined }
}
