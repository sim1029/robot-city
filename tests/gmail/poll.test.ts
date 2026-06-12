import { describe, expect, test, beforeAll, beforeEach, afterEach, afterAll } from 'bun:test'
import { installFetchMock, uninstallFetchMock, resetFetchMock, mockFetch } from '../_helpers/fetch-mock'
import { sqlite as db } from '../../src/db/client'
import { migrate } from '../../src/db/schema'
import { saveGmailTokens, loadGmailTokens } from '../../src/gmail/tokens'
import { pollGmail } from '../../src/gmail/poll'

const USER = 'me@example.com'

function seedTokens(historyId: string | null) {
  saveGmailTokens({
    user_id: USER,
    access_token: 'A',
    refresh_token: 'R',
    expires_at: Date.now() + 3_600_000,
    scope: 'gmail.modify',
    history_id: historyId,
  })
}

describe('pollGmail', () => {
  beforeAll(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-client'
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret'
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/auth/google/callback'
    migrate()
    installFetchMock()
  })
  beforeEach(() => {
    db.run('DELETE FROM gmail_tokens')
    db.run('DELETE FROM events')
  })
  afterEach(() => resetFetchMock())
  afterAll(() => uninstallFetchMock())

  test('first run with no watermark baselines from getProfile and yields no messages', async () => {
    seedTokens(null)
    mockFetch(/users\/me\/profile/, { json: { emailAddress: USER, historyId: '500' } })

    const result = await pollGmail(USER)

    expect(result.kind).toBe('baselined')
    expect(result.newMessageIds).toEqual([])
    expect(loadGmailTokens(USER)?.history_id).toBe('500')
  })

  test('subsequent run yields added message IDs and advances watermark', async () => {
    seedTokens('100')
    mockFetch(/users\/me\/history/, {
      json: {
        historyId: '105',
        history: [
          { messagesAdded: [{ message: { id: 'm1', threadId: 't1' } }] },
          { messagesAdded: [{ message: { id: 'm2', threadId: 't2' } }] },
        ],
      },
    })

    const result = await pollGmail(USER)
    expect(result.kind).toBe('synced')
    expect(result.newMessageIds).toEqual(['m1', 'm2'])
    expect(loadGmailTokens(USER)?.history_id).toBe('105')
  })

  test('on Gmail 404 (history gone), re-baselines from profile, drops the gap, and logs gmail:gap event', async () => {
    seedTokens('1')
    mockFetch(/users\/me\/history/, { status: 404, json: { error: { code: 404 } } })
    mockFetch(/users\/me\/profile/, { json: { emailAddress: USER, historyId: '999' } })

    const result = await pollGmail(USER)
    expect(result.kind).toBe('gap-recovered')
    expect(result.newMessageIds).toEqual([])
    expect(loadGmailTokens(USER)?.history_id).toBe('999')

    const events = db.query('SELECT type, payload FROM events WHERE type = ? ORDER BY id DESC LIMIT 1').get('gmail:gap') as { type: string; payload: string } | null
    expect(events).not.toBeNull()
    const payload = JSON.parse(events!.payload)
    expect(payload.from_history_id).toBe('1')
    expect(payload.recovered_history_id).toBe('999')
  })

  test('idempotent: running again with same watermark and no new history is a no-op', async () => {
    seedTokens('200')
    mockFetch(/users\/me\/history/, { json: { historyId: '200' } })

    const result = await pollGmail(USER)
    expect(result.kind).toBe('synced')
    expect(result.newMessageIds).toEqual([])
    expect(loadGmailTokens(USER)?.history_id).toBe('200')
  })
})
