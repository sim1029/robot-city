import { getApproval, setApprovalDiscordMessage } from '../approvals/state'
import { buildApprovalCardPayload } from './approval_card'
import type { DiscordMessagePayload } from './approval_card'

const DISCORD_API = 'https://discord.com/api/v10'

function authHeaders(): Record<string, string> {
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) throw new Error('DISCORD_BOT_TOKEN must be set')
  return { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' }
}

export interface SentDmRef {
  channelId: string
  messageId: string
}

export async function openDmChannel(userId: string): Promise<string> {
  const channelRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ recipient_id: userId }),
  })
  if (!channelRes.ok) throw new Error(`Discord open DM ${channelRes.status}: ${await channelRes.text()}`)
  const channel = await channelRes.json() as { id: string }
  return channel.id
}

export async function sendDm(userId: string, payload: DiscordMessagePayload): Promise<SentDmRef> {
  const channelId = await openDmChannel(userId)

  const msgRes = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  })
  if (!msgRes.ok) throw new Error(`Discord DM send ${msgRes.status}: ${await msgRes.text()}`)
  const msg = await msgRes.json() as { id: string }
  return { channelId, messageId: msg.id }
}

export async function editChannelMessage(channelId: string, messageId: string, payload: DiscordMessagePayload): Promise<void> {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Discord edit message ${res.status}: ${await res.text()}`)
}

export async function sendThreadMessage(threadId: string, content: string): Promise<string> {
  const res = await fetch(`${DISCORD_API}/channels/${threadId}/messages`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error(`Discord thread message ${res.status}: ${await res.text()}`)
  const msg = await res.json() as { id: string }
  return msg.id
}

export async function sendApprovalCardForApproval(approvalId: string, discordUserId: string): Promise<void> {
  const approval = getApproval(approvalId)
  if (!approval) throw new Error(`Approval ${approvalId} not found`)
  const payload = buildApprovalCardPayload(approval)
  const ref = await sendDm(discordUserId, payload)
  setApprovalDiscordMessage(approvalId, ref.messageId)
}

export async function sendTypingIndicator(channelId: string): Promise<void> {
  await fetch(`${DISCORD_API}/channels/${channelId}/typing`, {
    method: 'POST',
    headers: authHeaders(),
  }).catch(() => {})
}
