import { describe, expect, test, beforeAll, beforeEach, afterEach, afterAll } from 'bun:test'
import { installFetchMock, uninstallFetchMock, resetFetchMock, mockFetch, fetchCalls } from '../_helpers/fetch-mock'
import { db } from '../../src/db/client'
import { migrate } from '../../src/db/schema'
import { saveGmailTokens } from '../../src/gmail/tokens'
import { setSetting } from '../../src/db/settings'
import { createCalendarEvent, withOffset } from '../../src/tools/create_calendar_event'

const USER = 'me@example.com'

describe('withOffset', () => {
  test('appends DST offset for summer date in America/New_York', () => {
    expect(withOffset('2026-06-20T10:00:00', 'America/New_York')).toBe('2026-06-20T10:00:00-04:00')
  })

  test('appends standard offset for winter date in America/New_York', () => {
    expect(withOffset('2026-01-20T10:00:00', 'America/New_York')).toBe('2026-01-20T10:00:00-05:00')
  })

  test('passes through datetime with existing offset', () => {
    expect(withOffset('2026-06-20T10:00:00-04:00', 'America/New_York')).toBe('2026-06-20T10:00:00-04:00')
  })

  test('passes through datetime with Z suffix', () => {
    expect(withOffset('2026-06-20T14:00:00Z', 'America/New_York')).toBe('2026-06-20T14:00:00Z')
  })

  test('handles UTC timezone', () => {
    expect(withOffset('2026-06-20T10:00:00', 'UTC')).toBe('2026-06-20T10:00:00+00:00')
  })

  test('handles non-DST timezone (Phoenix)', () => {
    expect(withOffset('2026-06-20T10:00:00', 'America/Phoenix')).toBe('2026-06-20T10:00:00-07:00')
    expect(withOffset('2026-01-20T10:00:00', 'America/Phoenix')).toBe('2026-01-20T10:00:00-07:00')
  })

  // DST starts in NY on 2026-03-08 at 02:00 EST -> 03:00 EDT. The naive UTC-parse
  // approach picks the EST offset for these morning wall times because the instant
  // parsed as UTC still falls before the transition; verify the wall-time-resolving
  // logic picks EDT instead.
  test('spring-forward: wall time after the gap resolves to EDT (-04:00)', () => {
    expect(withOffset('2026-03-08T03:30:00', 'America/New_York')).toBe('2026-03-08T03:30:00-04:00')
    expect(withOffset('2026-03-08T06:00:00', 'America/New_York')).toBe('2026-03-08T06:00:00-04:00')
  })

  test('spring-forward: wall time before the gap stays on EST (-05:00)', () => {
    expect(withOffset('2026-03-08T01:00:00', 'America/New_York')).toBe('2026-03-08T01:00:00-05:00')
  })

  // DST ends in NY on 2026-11-01 at 02:00 EDT -> 01:00 EST. Wall times at/after the
  // fall-back should resolve to EST (-05:00); times before stay on EDT (-04:00).
  test('fall-back: wall time after the repeat resolves to EST (-05:00)', () => {
    expect(withOffset('2026-11-01T02:30:00', 'America/New_York')).toBe('2026-11-01T02:30:00-05:00')
    expect(withOffset('2026-11-01T05:00:00', 'America/New_York')).toBe('2026-11-01T05:00:00-05:00')
  })

  test('fall-back: wall time before the repeat stays on EDT (-04:00)', () => {
    expect(withOffset('2026-11-01T00:30:00', 'America/New_York')).toBe('2026-11-01T00:30:00-04:00')
  })
})

describe('createCalendarEvent', () => {
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
    db.run('DELETE FROM user_settings')
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

  test('sends DST-aware offset in dateTime for summer event in America/New_York', async () => {
    setSetting('timezone', 'America/New_York')
    mockFetch(/calendar\/v3\/calendars\/primary\/events/, {
      json: { id: 'evt-1', summary: 'Golf', start: {}, end: {}, htmlLink: 'https://cal.example/1' },
    })

    await createCalendarEvent(
      { title: 'Golf with Trevor and Harry', start: '2026-06-20T10:00:00', end: '2026-06-20T14:00:00' },
      { gmailUserId: USER, sessionId: null }
    )

    const call = fetchCalls().find(c => c.method === 'POST')
    expect(call).toBeTruthy()
    const body = call!.bodyJson() as { start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string } }
    expect(body.start.dateTime).toBe('2026-06-20T10:00:00-04:00')
    expect(body.end.dateTime).toBe('2026-06-20T14:00:00-04:00')
    expect(body.start.timeZone).toBe('America/New_York')
  })

  test('sends standard-time offset in dateTime for winter event in America/New_York', async () => {
    setSetting('timezone', 'America/New_York')
    mockFetch(/calendar\/v3\/calendars\/primary\/events/, {
      json: { id: 'evt-2', summary: 'Ski trip', start: {}, end: {} },
    })

    await createCalendarEvent(
      { title: 'Ski trip', start: '2026-01-20T08:00:00', end: '2026-01-20T17:00:00' },
      { gmailUserId: USER, sessionId: null }
    )

    const call = fetchCalls().find(c => c.method === 'POST')
    const body = call!.bodyJson() as { start: { dateTime: string }; end: { dateTime: string } }
    expect(body.start.dateTime).toBe('2026-01-20T08:00:00-05:00')
    expect(body.end.dateTime).toBe('2026-01-20T17:00:00-05:00')
  })

  test('preserves explicit offset already present in caller-provided dateTime', async () => {
    setSetting('timezone', 'America/New_York')
    mockFetch(/calendar\/v3\/calendars\/primary\/events/, {
      json: { id: 'evt-3', summary: 'X', start: {}, end: {} },
    })

    await createCalendarEvent(
      { title: 'X', start: '2026-06-20T10:00:00-04:00', end: '2026-06-20T14:00:00-04:00' },
      { gmailUserId: USER, sessionId: null }
    )

    const call = fetchCalls().find(c => c.method === 'POST')
    const body = call!.bodyJson() as { start: { dateTime: string }; end: { dateTime: string } }
    expect(body.start.dateTime).toBe('2026-06-20T10:00:00-04:00')
    expect(body.end.dateTime).toBe('2026-06-20T14:00:00-04:00')
  })
})
