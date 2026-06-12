import { and, asc, eq, isNotNull } from 'drizzle-orm'
import { db } from '../db/client'
import { events } from '../db/tables'

const DISCORD_API = 'https://discord.com/api/v10'
const FOOTER_SEPARATOR = '─────────────────────────────────'

export interface ThreadHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

interface DiscordMessage {
  id: string
  content: string
  timestamp?: string
  author: { id: string; username?: string; bot?: boolean }
  attachments?: Array<{ id: string }>
}

export async function fetchThreadHistory(
  threadId: string,
  beforeMessageId?: string,
  limit = 20
): Promise<ThreadHistoryMessage[]> {
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) throw new Error('DISCORD_BOT_TOKEN must be set')

  const params = new URLSearchParams({ limit: String(limit) })
  if (beforeMessageId) params.set('before', beforeMessageId)

  const res = await fetch(`${DISCORD_API}/channels/${threadId}/messages?${params.toString()}`, {
    method: 'GET',
    headers: { Authorization: `Bot ${token}` },
  })
  if (!res.ok) throw new Error(`Discord fetch history ${res.status}: ${await res.text()}`)
  const raw = await res.json() as DiscordMessage[]

  // Discord returns newest-first; reverse for chronological order
  const chronological = [...raw].reverse()
  const transcripts = loadAudioTranscripts(threadId)

  return chronological
    .map(msg => toHistoryMessage(msg, transcripts.get(msg.id)))
    .filter((m): m is ThreadHistoryMessage => m !== null)
}

function toHistoryMessage(msg: DiscordMessage, transcript?: string): ThreadHistoryMessage | null {
  const role: 'user' | 'assistant' = msg.author.bot ? 'assistant' : 'user'
  const visibleContent = role === 'assistant' ? stripFooter(msg.content) : msg.content
  const content = role === 'user' && transcript
    ? mergeTranscriptIntoUserContent(visibleContent, transcript)
    : visibleContent
  if (!content.trim()) return null
  return { role, content }
}

function stripFooter(content: string): string {
  const idx = content.indexOf(FOOTER_SEPARATOR)
  if (idx === -1) return content
  return content.slice(0, idx).trimEnd()
}

function mergeTranscriptIntoUserContent(content: string, transcript: string): string {
  const trimmedContent = content.trim()
  const trimmedTranscript = transcript.trim()
  if (!trimmedContent) return trimmedTranscript
  return `${trimmedContent}\n\n[TRANSCRIBED AUDIO]\n${trimmedTranscript}`
}

function loadAudioTranscripts(threadId: string): Map<string, string> {
  const rows = db.select({ payload: events.payload, output: events.output })
    .from(events)
    .where(and(
      eq(events.sessionId, `discord:${threadId}`),
      eq(events.type, 'audio:transcription'),
      isNotNull(events.output),
    ))
    .orderBy(asc(events.id))
    .all()

  const transcripts = new Map<string, string>()
  for (const row of rows) {
    if (!row.payload || !row.output) continue
    try {
      const payload = JSON.parse(row.payload) as { messageId?: unknown }
      if (typeof payload.messageId === 'string') transcripts.set(payload.messageId, row.output)
    } catch {
      // Ignore malformed legacy/debug payloads.
    }
  }
  return transcripts
}
