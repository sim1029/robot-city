import { describe, expect, test, beforeAll, beforeEach } from 'bun:test'
import { sqlite as db } from '../../src/db/client'
import { migrate } from '../../src/db/schema'
import {
  createApproval,
  getApproval,
  approveApproval,
  rejectApproval,
  expireApproval,
  ApprovalStateError,
  registerApprovalHandler,
  resetApprovalHandlersForTest,
} from '../../src/approvals/state'

describe('approval state machine', () => {
  beforeAll(() => migrate())
  beforeEach(() => {
    db.run('DELETE FROM pending_approvals')
    resetApprovalHandlersForTest()
  })

  test('createApproval persists in pending state with payload', () => {
    const id = createApproval({
      action: 'send_email',
      payload: { to: 'a@b.com', subject: 'hi', body: 'hello' },
      sessionId: 's1',
    })
    const a = getApproval(id)
    expect(a?.status).toBe('pending')
    expect(a?.action).toBe('send_email')
    expect(a?.payload).toEqual({ to: 'a@b.com', subject: 'hi', body: 'hello' })
    expect(a?.session_id).toBe('s1')
  })

  test('approveApproval calls registered handler and transitions to approved', async () => {
    let handlerCalled: unknown = null
    registerApprovalHandler('send_email', async (payload) => {
      handlerCalled = payload
      return { sent_id: 'gmail-1' }
    })

    const id = createApproval({
      action: 'send_email',
      payload: { to: 'a@b.com', subject: 'hi', body: 'hello' },
    })
    const result = await approveApproval(id)

    expect(handlerCalled).toEqual({ to: 'a@b.com', subject: 'hi', body: 'hello' })
    expect(result.status).toBe('approved')
    expect(result.handler_result).toEqual({ sent_id: 'gmail-1' })
    expect(getApproval(id)?.status).toBe('approved')
  })

  test('rejectApproval transitions to rejected and does NOT call handler', async () => {
    let handlerCalled = false
    registerApprovalHandler('send_email', async () => {
      handlerCalled = true
      return {}
    })
    const id = createApproval({ action: 'send_email', payload: {} })
    await rejectApproval(id, 'user cancelled')
    expect(handlerCalled).toBe(false)
    expect(getApproval(id)?.status).toBe('rejected')
    expect(getApproval(id)?.reject_reason).toBe('user cancelled')
  })

  test('cannot approve an already-resolved approval', async () => {
    registerApprovalHandler('send_email', async () => ({}))
    const id = createApproval({ action: 'send_email', payload: {} })
    await approveApproval(id)
    expect(approveApproval(id)).rejects.toBeInstanceOf(ApprovalStateError)
  })

  test('cannot reject an already-resolved approval', async () => {
    registerApprovalHandler('send_email', async () => ({}))
    const id = createApproval({ action: 'send_email', payload: {} })
    await rejectApproval(id)
    expect(rejectApproval(id)).rejects.toBeInstanceOf(ApprovalStateError)
  })

  test('expireApproval transitions pending to expired (idempotent on terminal)', async () => {
    const id = createApproval({ action: 'send_email', payload: {} })
    await expireApproval(id)
    expect(getApproval(id)?.status).toBe('expired')
  })

  test('approve fails if no handler registered for action', async () => {
    const id = createApproval({ action: 'send_email', payload: {} })
    expect(approveApproval(id)).rejects.toThrow(/no handler/i)
  })
})
