import { describe, expect, test } from 'bun:test'
import { buildApprovalCardPayload, buildEditModal, buildResolvedCardPayload, parseApprovalCustomId } from '../../src/discord/approval_card'

const baseApproval = {
  id: 'abc-123',
  action: 'send_email',
  payload: { to: 'a@b.com', subject: 'hi', body: 'hello world' },
  status: 'pending' as const,
  session_id: 's1',
  discord_message_id: null,
  reject_reason: null,
  handler_result: null,
  created_at: 0,
  resolved_at: null,
}

describe('approval card payloads', () => {
  test('pending card includes Approve/Edit/Cancel buttons with stable custom_ids', () => {
    const payload = buildApprovalCardPayload(baseApproval)
    expect(payload.content).toContain('a@b.com')
    expect(payload.content).toContain('hi')
    expect(payload.components).toHaveLength(1)
    const buttons = payload.components[0].components
    expect(buttons).toHaveLength(3)
    expect(buttons[0].custom_id).toBe('approval:abc-123:approve')
    expect(buttons[0].label).toBe('Approve')
    expect(buttons[0].style).toBe(3) // GREEN
    expect(buttons[1].custom_id).toBe('approval:abc-123:edit')
    expect(buttons[1].label).toBe('Edit')
    expect(buttons[1].style).toBe(2) // SECONDARY
    expect(buttons[2].custom_id).toBe('approval:abc-123:reject')
    expect(buttons[2].label).toBe('Cancel')
    expect(buttons[2].style).toBe(4) // RED
  })

  test('resolved approved card has no buttons and shows status', () => {
    const payload = buildResolvedCardPayload(
      {
        ...baseApproval,
        status: 'approved',
        handler_result: { id: 'gmail-1' },
        resolved_at: 0,
      },
      'approved'
    )
    expect(payload.content).toContain('Sent')
    expect(payload.components).toEqual([])
  })

  test('resolved rejected card shows cancellation', () => {
    const payload = buildResolvedCardPayload(
      {
        ...baseApproval,
        status: 'rejected',
        reject_reason: 'user cancelled',
        resolved_at: 0,
      },
      'rejected'
    )
    expect(payload.content).toMatch(/cancel/i)
    expect(payload.components).toEqual([])
  })

  test('parseApprovalCustomId rejects malformed ids', () => {
    expect(parseApprovalCustomId('approval:abc:approve')).toEqual({ id: 'abc', decision: 'approve' })
    expect(parseApprovalCustomId('approval:abc:reject')).toEqual({ id: 'abc', decision: 'reject' })
    expect(parseApprovalCustomId('approval:abc:edit')).toEqual({ id: 'abc', decision: 'edit' })
    expect(parseApprovalCustomId('other:abc:approve')).toBeNull()
    expect(parseApprovalCustomId('approval:abc:explode')).toBeNull()
    expect(parseApprovalCustomId('approval:abc')).toBeNull()
  })

  test('buildEditModal produces a modal with subject and body inputs', () => {
    const modal = buildEditModal(baseApproval)
    expect(modal.title).toBe('Edit Email')
    expect(modal.custom_id).toBe('approval:abc-123:edit_submit')
    expect(modal.components).toHaveLength(2)

    const subjectRow = modal.components[0]
    expect(subjectRow.type).toBe(1)
    const subjectInput = subjectRow.components[0]
    expect(subjectInput.custom_id).toBe('subject')
    expect(subjectInput.style).toBe(1) // SHORT
    expect(subjectInput.value).toBe('hi')

    const bodyRow = modal.components[1]
    const bodyInput = bodyRow.components[0]
    expect(bodyInput.custom_id).toBe('body')
    expect(bodyInput.style).toBe(2) // PARAGRAPH
    expect(bodyInput.value).toBe('hello world')
  })

  test('buildEditModal leaves body empty when body exceeds 4000 chars', () => {
    const longBody = 'x'.repeat(4001)
    const modal = buildEditModal({ ...baseApproval, payload: { to: 'a@b.com', subject: 'hi', body: longBody } })
    const bodyInput = modal.components[1].components[0]
    expect(bodyInput.value).toBe('')
  })

  test('buildEditModal prefills body when body is exactly 4000 chars', () => {
    const exactBody = 'x'.repeat(4000)
    const modal = buildEditModal({ ...baseApproval, payload: { to: 'a@b.com', subject: 'hi', body: exactBody } })
    const bodyInput = modal.components[1].components[0]
    expect(bodyInput.value).toBe(exactBody)
  })
})
