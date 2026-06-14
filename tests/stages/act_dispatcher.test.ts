import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { sqlite as db } from '../../src/db/client'
import { migrate } from '../../src/db/schema'
import { saveGmailTokens } from '../../src/gmail/tokens'
import { dispatchToolCall } from '../../src/stages/act_dispatcher'
import { fetchCalls, installFetchMock, mockFetch, resetFetchMock, uninstallFetchMock } from '../_helpers/fetch-mock'

describe('act dispatcher', () => {
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
    saveGmailTokens({
      user_id: 'me@example.com',
      access_token: 'A',
      refresh_token: 'R',
      expires_at: Date.now() + 3_600_000,
      scope: 'calendar.events',
    })
  })

  afterEach(() => resetFetchMock())
  afterAll(() => uninstallFetchMock())

  test('passes create_calendar_event calendarId through to the tool', async () => {
    mockFetch(/calendars\/work%40example.com\/events$/, { json: { id: 'evt-1', summary: 'Review' } })

    const result = await dispatchToolCall(
      'create_calendar_event',
      {
        title: 'Review',
        start: '2026-05-15T14:00:00Z',
        end: '2026-05-15T14:30:00Z',
        calendarId: 'work@example.com',
      },
      { gmailUserId: 'me@example.com', discordUserId: 'discord-user', sessionId: null }
    )

    expect(result.kind).toBe('executed')
    expect(fetchCalls().find(c => c.method === 'POST')?.url).toContain('/calendars/work%40example.com/events')
  })

  test('passes create_calendar_event snake_case calendar_id through to the tool', async () => {
    mockFetch(/calendars\/primary\/events$/, { json: { id: 'evt-2', summary: 'Gym' } })

    const result = await dispatchToolCall(
      'create_calendar_event',
      {
        title: 'Gym',
        start: '2026-05-21T07:00:00',
        end: '2026-05-21T08:00:00',
        calendar_id: 'primary',
      },
      { gmailUserId: 'me@example.com', discordUserId: 'discord-user', sessionId: null }
    )

    expect(result.kind).toBe('executed')
    expect(fetchCalls().find(c => c.method === 'POST')?.url).toContain('/calendars/primary/events')
  })
})
