import { describe, expect, test, beforeAll, beforeEach, afterEach, afterAll } from 'bun:test'
import { installFetchMock, uninstallFetchMock, resetFetchMock, mockFetch } from '../_helpers/fetch-mock'
import { db } from '../../src/db/client'
import { migrate } from '../../src/db/schema'
import {
  saveGmailTokens,
  loadGmailTokens,
  getValidGmailAccessToken,
} from '../../src/gmail/tokens'

describe('gmail tokens', () => {
  beforeAll(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-client'
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret'
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/auth/google/callback'
    migrate()
    installFetchMock()
  })
  beforeEach(() => {
    db.run('DELETE FROM gmail_tokens')
  })
  afterEach(() => resetFetchMock())
  afterAll(() => uninstallFetchMock())

  test('round-trips tokens through SQLite', () => {
    saveGmailTokens({
      user_id: 'me@example.com',
      access_token: 'A',
      refresh_token: 'R',
      expires_at: 9_999_999_999,
      scope: 'gmail.modify',
    })
    const loaded = loadGmailTokens('me@example.com')
    expect(loaded?.access_token).toBe('A')
    expect(loaded?.refresh_token).toBe('R')
    expect(loaded?.expires_at).toBe(9_999_999_999)
  })

  test('getValidGmailAccessToken returns stored token when not expired', async () => {
    saveGmailTokens({
      user_id: 'me@example.com',
      access_token: 'still-good',
      refresh_token: 'R',
      expires_at: Date.now() + 60_000,
      scope: 'gmail.modify',
    })
    const token = await getValidGmailAccessToken('me@example.com')
    expect(token).toBe('still-good')
  })

  test('getValidGmailAccessToken refreshes when expired and persists new access', async () => {
    saveGmailTokens({
      user_id: 'me@example.com',
      access_token: 'stale',
      refresh_token: 'R',
      expires_at: Date.now() - 1_000,
      scope: 'gmail.modify',
    })
    mockFetch('https://oauth2.googleapis.com/token', {
      json: { access_token: 'fresh', expires_in: 3600, scope: 'gmail.modify', token_type: 'Bearer' },
    })
    const token = await getValidGmailAccessToken('me@example.com')
    expect(token).toBe('fresh')
    const reloaded = loadGmailTokens('me@example.com')
    expect(reloaded?.access_token).toBe('fresh')
    expect(reloaded?.expires_at ?? 0).toBeGreaterThan(Date.now())
  })

  test('getValidGmailAccessToken throws when no tokens stored', async () => {
    expect(getValidGmailAccessToken('nobody@example.com')).rejects.toThrow(/no gmail tokens/i)
  })
})
