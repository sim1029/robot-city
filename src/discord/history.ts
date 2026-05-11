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

  return chronological
    .map(toHistoryMessage)
    .filter((m): m is ThreadHistoryMessage => m !== null)
}

function toHistoryMessage(msg: DiscordMessage): ThreadHistoryMessage | null {
  const role: 'user' | 'assistant' = msg.author.bot ? 'assistant' : 'user'
  const content = role === 'assistant' ? stripFooter(msg.content) : msg.content
  if (!content.trim()) return null
  return { role, content }
}

function stripFooter(content: string): string {
  const idx = content.indexOf(FOOTER_SEPARATOR)
  if (idx === -1) return content
  return content.slice(0, idx).trimEnd()
}
