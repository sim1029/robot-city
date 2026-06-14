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

export interface DiscordTextInput {
  type: 4
  custom_id: string
  label: string
  style: 1 | 2
  value?: string
  required?: boolean
  max_length?: number
}

export interface DiscordModal {
  title: string
  custom_id: string
  components: Array<{ type: 1; components: DiscordTextInput[] }>
}

const MODAL_BODY_LIMIT = 4000

export function buildApprovalCardPayload(a: Approval): DiscordMessagePayload {
  const content = describeApproval(a)
  return {
    content: `**Approval needed**\n${content}`,
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: BUTTON_STYLE.GREEN, label: 'Approve', custom_id: `approval:${a.id}:approve` },
          { type: 2, style: BUTTON_STYLE.SECONDARY, label: 'Edit', custom_id: `approval:${a.id}:edit` },
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

export function buildEditModal(a: Approval): DiscordModal {
  const p = a.payload as { to?: string; subject?: string; body?: string }
  const subject = p.subject ?? ''
  const body = p.body ?? ''
  return {
    title: 'Edit Email',
    custom_id: `approval:${a.id}:edit_submit`,
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: 'subject',
            label: 'Subject',
            style: 1,
            required: true,
            value: subject,
            max_length: 998,
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: 'body',
            label: 'Body',
            style: 2,
            required: true,
            value: body.length <= MODAL_BODY_LIMIT ? body : '',
            max_length: MODAL_BODY_LIMIT,
          },
        ],
      },
    ],
  }
}

export function buildReauthCardPayload(retryId: string, reauthUrl: string): DiscordMessagePayload {
  return {
    content: `**Google authentication has expired.**\n[Re-authenticate with Google](${reauthUrl})\n\nOnce signed in, press **Retry** to run your request again.`,
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: BUTTON_STYLE.PRIMARY, label: 'Retry', custom_id: `reauth:${retryId}:retry` },
        ],
      },
    ],
  }
}

export interface ParsedCustomId {
  id: string
  decision: 'approve' | 'reject' | 'edit'
}

export function parseApprovalCustomId(customId: string): ParsedCustomId | null {
  const parts = customId.split(':')
  if (parts.length !== 3) return null
  const [prefix, id, decision] = parts
  if (prefix !== 'approval') return null
  if (decision !== 'approve' && decision !== 'reject' && decision !== 'edit') return null
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
