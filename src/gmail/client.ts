const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1'

export class GmailHistoryGoneError extends Error {
  constructor() {
    super('Gmail history watermark too old (404). Re-baseline required.')
    this.name = 'GmailHistoryGoneError'
  }
}

export interface GmailHeaders {
  from?: string
  subject?: string
  date?: string
}

export interface GmailMessage {
  id: string
  threadId: string
  snippet: string
  headers: GmailHeaders
}

export interface GmailHistoryResult {
  historyId: string
  addedMessageIds: string[]
}

export interface GmailProfile {
  emailAddress: string
  historyId: string
}

export interface SendArgs {
  to: string
  subject: string
  body: string
}

export async function listHistory(accessToken: string, startHistoryId: string): Promise<GmailHistoryResult> {
  const url = `${GMAIL_API}/users/me/history?startHistoryId=${encodeURIComponent(startHistoryId)}&historyTypes=messageAdded`
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } })
  if (res.status === 404) throw new GmailHistoryGoneError()
  if (!res.ok) throw new Error(`Gmail history.list ${res.status}: ${await res.text()}`)
  const data = await res.json() as {
    historyId: string
    history?: Array<{ messagesAdded?: Array<{ message: { id: string } }> }>
  }
  const addedMessageIds: string[] = []
  for (const h of data.history ?? []) {
    for (const m of h.messagesAdded ?? []) {
      addedMessageIds.push(m.message.id)
    }
  }
  return { historyId: data.historyId, addedMessageIds }
}

export async function getMessage(accessToken: string, messageId: string): Promise<GmailMessage> {
  const url = `${GMAIL_API}/users/me/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`Gmail messages.get ${res.status}: ${await res.text()}`)
  const data = await res.json() as {
    id: string
    threadId: string
    snippet?: string
    payload?: { headers?: Array<{ name: string; value: string }> }
  }
  return {
    id: data.id,
    threadId: data.threadId,
    snippet: data.snippet ?? '',
    headers: parseHeaders(data.payload?.headers ?? []),
  }
}

export async function getProfile(accessToken: string): Promise<GmailProfile> {
  const res = await fetch(`${GMAIL_API}/users/me/profile`, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Gmail profile ${res.status}: ${await res.text()}`)
  return res.json() as Promise<GmailProfile>
}

export async function sendMessage(accessToken: string, args: SendArgs): Promise<{ id: string; threadId: string }> {
  const raw = base64url(buildRfc822(args))
  const res = await fetch(`${GMAIL_API}/users/me/messages/send`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  })
  if (!res.ok) throw new Error(`Gmail send ${res.status}: ${await res.text()}`)
  return res.json() as Promise<{ id: string; threadId: string }>
}

export function buildRfc822({ to, subject, body }: SendArgs): string {
  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
  ].join('\r\n')
  const normalizedBody = body.replace(/\r?\n/g, '\r\n')
  return `${headers}\r\n\r\n${normalizedBody}`
}

export function base64url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function parseHeaders(headers: Array<{ name: string; value: string }>): GmailHeaders {
  const out: GmailHeaders = {}
  for (const h of headers) {
    const k = h.name.toLowerCase()
    if (k === 'from') out.from = h.value
    else if (k === 'subject') out.subject = h.value
    else if (k === 'date') out.date = h.value
  }
  return out
}
