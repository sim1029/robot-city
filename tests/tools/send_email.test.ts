import { describe, expect, test, beforeAll, beforeEach, afterEach, afterAll } from 'bun:test'
import { installFetchMock, uninstallFetchMock, resetFetchMock, mockFetch, fetchCalls } from '../_helpers/fetch-mock'
import { db } from '../../src/db/client'
import { migrate } from '../../src/db/schema'
import { saveGmailTokens } from '../../src/gmail/tokens'
import {
  registerSendEmailTool,
  requestSendEmail,
} from '../../src/tools/send_email'
import {
  approveApproval,
  rejectApproval,
  getApproval,
  resetApprovalHandlersForTest,
} from '../../src/approvals/state'

const USER = 'me@example.com'

describe('send_email tool', () => {
  beforeAll(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-client'
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret'
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/auth/google/callback'
    migrate()
    installFetchMock()
  })
  beforeEach(() => {
    db.run('DELETE FROM gmail_tokens')
    db.run('DELETE FROM pending_approvals')
    db.run('DELETE FROM events')
    resetApprovalHandlersForTest()
    registerSendEmailTool(USER)
    saveGmailTokens({
      user_id: USER,
      access_token: 'A',
      refresh_token: 'R',
      expires_at: Date.now() + 3_600_000,
      scope: 'gmail.modify',
    })
  })
  afterEach(() => resetFetchMock())
  afterAll(() => uninstallFetchMock())

  test('requestSendEmail creates pending approval and does NOT call Gmail', async () => {
    const id = await requestSendEmail({ to: 'a@b.com', subject: 'hi', body: 'hello' }, { sessionId: 's1' })
    const a = getApproval(id)
    expect(a?.status).toBe('pending')
    expect(a?.action).toBe('send_email')
    expect(fetchCalls()).toHaveLength(0)
  })

  test('approving the approval calls Gmail send and logs tool:send_email event', async () => {
    mockFetch(/users\/me\/messages\/send/, { json: { id: 'gmail-1', threadId: 'gth-1' } })

    const id = await requestSendEmail({ to: 'a@b.com', subject: 'hi', body: 'hello' }, { sessionId: 's1' })
    const result = await approveApproval(id)

    expect(result.status).toBe('approved')
    expect(result.handler_result).toEqual({ id: 'gmail-1', threadId: 'gth-1' })
    expect(fetchCalls()).toHaveLength(1)

    const ev = db.query("SELECT type, payload, output FROM events WHERE type = 'tool:send_email' ORDER BY id DESC LIMIT 1").get() as { type: string; payload: string; output: string } | null
    expect(ev).not.toBeNull()
    const payload = JSON.parse(ev!.payload)
    expect(payload.to).toBe('a@b.com')
    expect(payload.subject).toBe('hi')
    const output = JSON.parse(ev!.output)
    expect(output.success).toBe(true)
    expect(payload.body).toBeUndefined()
  })

  test('rejecting the approval discards without calling Gmail', async () => {
    const id = await requestSendEmail({ to: 'a@b.com', subject: 'hi', body: 'hello' }, { sessionId: 's1' })
    await rejectApproval(id, 'nope')
    expect(fetchCalls()).toHaveLength(0)
    expect(getApproval(id)?.status).toBe('rejected')
  })
})
