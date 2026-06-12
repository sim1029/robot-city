import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { approveApproval, getApproval, resetApprovalHandlersForTest } from '../../src/approvals/state'
import { sqlite as db } from '../../src/db/client'
import { insertEvent } from '../../src/db/events'
import { migrate } from '../../src/db/schema'
import { saveGmailTokens } from '../../src/gmail/tokens'
import { registerInviteAttendeesTool, requestInviteAttendees } from '../../src/tools/invite_attendees'
import { fetchCalls, installFetchMock, mockFetch, resetFetchMock, uninstallFetchMock } from '../_helpers/fetch-mock'

const USER = 'me@example.com'

describe('invite_attendees tool', () => {
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
    db.run('DELETE FROM sessions')
    resetApprovalHandlersForTest()
    registerInviteAttendeesTool(USER)
    saveGmailTokens({
      user_id: USER,
      access_token: 'A',
      refresh_token: 'R',
      expires_at: Date.now() + 3_600_000,
      scope: 'calendar.events',
    })
  })

  afterEach(() => resetFetchMock())
  afterAll(() => uninstallFetchMock())

  test('approval patches attendees on explicit calendarId', async () => {
    mockFetch(/calendars\/team%40example.com\/events\/evt-1$/, {
      json: { id: 'evt-1', summary: 'Planning', attendees: [] },
    }, { once: true })
    mockFetch(/calendars\/team%40example.com\/events\/evt-1$/, {
      json: { id: 'evt-1', summary: 'Planning', attendees: [{ email: 'a@example.com' }] },
    }, { once: true })

    const id = await requestInviteAttendees(
      { eventId: 'evt-1', emails: ['a@example.com'], calendarId: 'team@example.com' },
      { sessionId: null }
    )
    await approveApproval(id)

    expect(fetchCalls()).toHaveLength(2)
    expect(fetchCalls()[0].url).toContain('/calendars/team%40example.com/events/evt-1')
    expect(fetchCalls()[1].method).toBe('PATCH')
    expect(fetchCalls()[1].url).toContain('/calendars/team%40example.com/events/evt-1')
  })

  test('request infers calendarId from prior create event in same session', async () => {
    db.run("INSERT INTO sessions (id) VALUES ('s1')")
    insertEvent({
      sessionId: 's1',
      type: 'tool:create_calendar_event',
      payload: JSON.stringify({ title: 'Planning', calendar_id: 'team@example.com' }),
      output: JSON.stringify({ success: true, event_id: 'evt-2', calendar_id: 'team@example.com' }),
    })

    const id = await requestInviteAttendees({ eventId: 'evt-2', emails: ['a@example.com'] }, { sessionId: 's1' })
    expect(getApproval(id)?.payload).toMatchObject({ calendarId: 'team@example.com' })
  })
})
