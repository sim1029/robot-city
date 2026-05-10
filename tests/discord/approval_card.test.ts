import { describe, expect, test } from 'bun:test'
import { buildApprovalCardPayload, buildResolvedCardPayload, parseApprovalCustomId } from '../../src/discord/approval_card'

describe('approval card payloads', () => {
  test('pending card includes Approve/Reject buttons with stable custom_ids', () => {
    const payload = buildApprovalCardPayload({
      id: 'abc-123',
      action: 'send_email',
      payload: { to: 'a@b.com', subject: 'hi', body: 'hello world' },
      status: 'pending',
      session_id: 's1',
      discord_message_id: null,
      reject_reason: null,
      handler_result: null,
      created_at: 0,
      resolved_at: null,
    })
    expect(payload.content).toContain('a@b.com')
    expect(payload.content).toContain('hi')
    expect(payload.components).toHaveLength(1)
    const buttons = payload.components[0].components
    expect(buttons).toHaveLength(2)
    expect(buttons[0].custom_id).toBe('approval:abc-123:approve')
    expect(buttons[0].label).toBe('Approve')
    expect(buttons[0].style).toBe(3) // GREEN
    expect(buttons[1].custom_id).toBe('approval:abc-123:reject')
    expect(buttons[1].label).toBe('Cancel')
    expect(buttons[1].style).toBe(4) // RED
  })

  test('resolved approved card has no buttons and shows status', () => {
    const payload = buildResolvedCardPayload(
      {
        id: 'abc-123',
        action: 'send_email',
        payload: { to: 'a@b.com', subject: 'hi', body: 'x' },
        status: 'approved',
        session_id: null,
        discord_message_id: null,
        reject_reason: null,
        handler_result: { id: 'gmail-1' },
        created_at: 0,
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
        id: 'abc-123',
        action: 'send_email',
        payload: { to: 'a@b.com', subject: 'hi', body: 'x' },
        status: 'rejected',
        session_id: null,
        discord_message_id: null,
        reject_reason: 'user cancelled',
        handler_result: null,
        created_at: 0,
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
    expect(parseApprovalCustomId('other:abc:approve')).toBeNull()
    expect(parseApprovalCustomId('approval:abc:explode')).toBeNull()
    expect(parseApprovalCustomId('approval:abc')).toBeNull()
  })
})
