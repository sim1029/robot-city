import type { Approval } from '../approvals/state'

export const BUTTON_STYLE = { PRIMARY: 1, SECONDARY: 2, GREEN: 3, RED: 4 } as const

export interface DiscordButton {
  type: 2
  style: number
  label: string
  custom_id: string
}

export interface DiscordActionRow {
  type: 1
  components: DiscordButton[]
}

export interface DiscordMessagePayload {
  content: string
  components: DiscordActionRow[]
}

export function buildApprovalCardPayload(a: Approval): DiscordMessagePayload {
  const content = describeApproval(a)
  return {
    content: `**Approval needed**\n${content}`,
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: BUTTON_STYLE.GREEN, label: 'Approve', custom_id: `approval:${a.id}:approve` },
          { type: 2, style: BUTTON_STYLE.RED, label: 'Cancel', custom_id: `approval:${a.id}:reject` },
        ],
      },
    ],
  }
}

export function buildResolvedCardPayload(a: Approval, decision: 'approved' | 'rejected'): DiscordMessagePayload {
  const summary = describeApproval(a)
  const heading = decision === 'approved' ? '✅ Sent' : '❌ Cancelled'
  return { content: `**${heading}**\n${summary}`, components: [] }
}

export interface ParsedCustomId {
  id: string
  decision: 'approve' | 'reject'
}

export function parseApprovalCustomId(customId: string): ParsedCustomId | null {
  const parts = customId.split(':')
  if (parts.length !== 3) return null
  const [prefix, id, decision] = parts
  if (prefix !== 'approval') return null
  if (decision !== 'approve' && decision !== 'reject') return null
  return { id, decision }
}

function describeApproval(a: Approval): string {
  if (a.action === 'send_email') {
    const p = a.payload as { to?: string; subject?: string; body?: string }
    const bodyPreview = (p.body ?? '').slice(0, 500)
    return `**Send email** to \`${p.to}\`\n**Subject:** ${p.subject}\n\n${bodyPreview}`
  }
  return `Action: ${a.action}\n${JSON.stringify(a.payload).slice(0, 500)}`
}
