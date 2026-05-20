import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { createEvent, listCalendars, patchAttendees } from '../../src/calendar/client'
import { fetchCalls, installFetchMock, mockFetch, resetFetchMock, uninstallFetchMock } from '../_helpers/fetch-mock'

const TOKEN = 'calendar-token'

describe('calendar client', () => {
  beforeAll(() => installFetchMock())
  afterEach(() => resetFetchMock())
  afterAll(() => uninstallFetchMock())

  test('listCalendars fetches writable calendar list with bearer auth', async () => {
    mockFetch(/users\/me\/calendarList/, {
      json: {
        items: [
          { id: 'primary@example.com', summary: 'Primary', primary: true, accessRole: 'owner' },
          { id: 'work@example.com', summary: 'Work', accessRole: 'writer' },
        ],
      },
    })

    const calendars = await listCalendars(TOKEN, { minAccessRole: 'writer' })

    expect(calendars.map((c) => c.id)).toEqual(['primary@example.com', 'work@example.com'])
    const call = fetchCalls()[0]
    expect(call.url).toContain('/users/me/calendarList?')
    expect(call.url).toContain('minAccessRole=writer')
    expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`)
  })

  test('createEvent posts to primary by default', async () => {
    mockFetch(/calendars\/primary\/events$/, { json: { id: 'evt-1', summary: 'Lunch' } })

    await createEvent(TOKEN, {
      summary: 'Lunch',
      start: { dateTime: '2026-05-15T12:00:00Z' },
      end: { dateTime: '2026-05-15T13:00:00Z' },
    })

    const call = fetchCalls()[0]
    expect(call.method).toBe('POST')
    expect(call.url).toContain('/calendars/primary/events')
    expect(call.bodyJson()).toMatchObject({ summary: 'Lunch' })
  })

  test('createEvent posts to encoded calendarId when provided', async () => {
    mockFetch(/calendars\/team%40example.com\/events$/, { json: { id: 'evt-2', summary: 'Standup' } })

    await createEvent(
      TOKEN,
      {
        summary: 'Standup',
        start: { dateTime: '2026-05-15T09:00:00Z' },
        end: { dateTime: '2026-05-15T09:30:00Z' },
      },
      { calendarId: 'team@example.com' }
    )

    expect(fetchCalls()[0].url).toContain('/calendars/team%40example.com/events')
  })

  test('patchAttendees fetches and patches the provided calendarId', async () => {
    mockFetch(/calendars\/team%40example.com\/events\/evt-1$/, {
      json: { id: 'evt-1', summary: 'Standup', attendees: [{ email: 'existing@example.com' }] },
    }, { once: true })
    mockFetch(/calendars\/team%40example.com\/events\/evt-1$/, {
      json: { id: 'evt-1', summary: 'Standup', attendees: [{ email: 'existing@example.com' }, { email: 'new@example.com' }] },
    }, { once: true })

    await patchAttendees(TOKEN, 'evt-1', ['new@example.com'], { calendarId: 'team@example.com' })

    expect(fetchCalls()[0].url).toContain('/calendars/team%40example.com/events/evt-1')
    expect(fetchCalls()[1].method).toBe('PATCH')
    expect(fetchCalls()[1].url).toContain('/calendars/team%40example.com/events/evt-1')
  })
})
