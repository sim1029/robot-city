import { describe, expect, test, beforeAll, beforeEach, afterEach, afterAll } from 'bun:test'
import { installFetchMock, uninstallFetchMock, resetFetchMock, mockFetch } from '../_helpers/fetch-mock'
import { db } from '../../src/db/client'
import { migrate } from '../../src/db/schema'
import { saveGmailTokens } from '../../src/gmail/tokens'
import { triageMessage } from '../../src/workflows/inbox_triage'

const USER = 'me@example.com'
const TOKEN = 'access-xyz'

function mockGmailGet(id: string, headers: { from: string; subject: string }, snippet: string) {
  mockFetch((req) => req.url.includes(`/users/me/messages/${id}`), {
    json: {
      id, threadId: `t-${id}`, snippet,
      payload: { headers: [
        { name: 'From', value: headers.from },
        { name: 'Subject', value: headers.subject },
        { name: 'Date', value: 'Mon, 1 Jan 2026 00:00:00 +0000' },
      ] },
    },
  })
}

function mockAnthropic(text: string, model = 'claude-haiku-4-5-20251001') {
  mockFetch('https://api.anthropic.com/v1/messages', {
    json: {
      model,
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  }, { once: true })
}

describe('inbox.triage workflow', () => {
  beforeAll(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-client'
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret'
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/auth/google/callback'
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    migrate()
    installFetchMock()
  })
  beforeEach(() => {
    db.run('DELETE FROM gmail_tokens')
    db.run('DELETE FROM events')
    saveGmailTokens({
      user_id: USER,
      access_token: TOKEN,
      refresh_token: 'R',
      expires_at: Date.now() + 3_600_000,
      scope: 'gmail.modify',
    })
  })
  afterEach(() => resetFetchMock())
  afterAll(() => uninstallFetchMock())

  test('classifies as ignore → returns ignore, no draft, persists event', async () => {
    mockGmailGet('m1', { from: 'spam@x.com', subject: 'You won' }, 'Click here')
    mockAnthropic('IGNORE\nMarketing spam, not actionable.')

    const result = await triageMessage({ userId: USER, messageId: 'm1', sessionId: 's1' })

    expect(result.classification).toBe('ignore')
    expect(result.draft).toBeUndefined()
    expect(result.shouldNotify).toBe(false)

    const ev = db.query("SELECT payload FROM events WHERE type = 'workflow:triage' ORDER BY id DESC LIMIT 1").get() as { payload: string } | null
    expect(ev).not.toBeNull()
    const payload = JSON.parse(ev!.payload)
    expect(payload.message_id).toBe('m1')
    expect(payload.classification).toBe('ignore')
  })

  test('classifies as respond → runs reason, returns draft, flags for notify', async () => {
    mockGmailGet('m2', { from: 'colleague@x.com', subject: 'Quick question' }, 'Can you review?')
    mockAnthropic('RESPOND\nNeeds a one-line reply.')
    mockAnthropic('Plan: confirm I will review by tomorrow.\n\nDRAFT:\nHi — yes, I will review by EOD tomorrow.', 'claude-sonnet-4-6')

    const result = await triageMessage({ userId: USER, messageId: 'm2', sessionId: 's1' })

    expect(result.classification).toBe('respond')
    expect(result.shouldNotify).toBe(true)
    expect(result.draft).toContain('I will review')
    expect(result.summary).toContain('Plan:')
  })

  test('classifies as urgent → flags for notify', async () => {
    mockGmailGet('m3', { from: 'boss@x.com', subject: 'URGENT: prod down' }, 'Servers offline')
    mockAnthropic('URGENT\nProduction outage, immediate action.')
    mockAnthropic('Plan: page on-call now.\n\nDRAFT:\nPaging on-call.', 'claude-sonnet-4-6')

    const result = await triageMessage({ userId: USER, messageId: 'm3', sessionId: 's1' })
    expect(result.classification).toBe('urgent')
    expect(result.shouldNotify).toBe(true)
  })

  test('falls back to "respond" if classifier returns unknown label', async () => {
    mockGmailGet('m4', { from: 'a@b.com', subject: 'hi' }, 'hello')
    mockAnthropic('MAYBE\nNot sure.')
    mockAnthropic('Plan: ask for clarification.\n\nDRAFT:\nCan you say more?', 'claude-sonnet-4-6')

    const result = await triageMessage({ userId: USER, messageId: 'm4', sessionId: 's1' })
    expect(result.classification).toBe('respond')
  })
})
