const BASE = 'https://www.googleapis.com/calendar/v3'

export interface CalendarEventDateTime {
  dateTime?: string
  date?: string
  timeZone?: string
}

export interface CalendarAttendee {
  email: string
  displayName?: string
  responseStatus?: string
}

export interface CalendarEvent {
  id: string
  summary: string
  description?: string
  location?: string
  start: CalendarEventDateTime
  end: CalendarEventDateTime
  attendees?: CalendarAttendee[]
  htmlLink?: string
}

export interface CalendarListEntry {
  id: string
  summary: string
  primary?: boolean
  accessRole?: string
}

export interface CalendarEventInput {
  summary: string
  start: CalendarEventDateTime
  end: CalendarEventDateTime
  description?: string
  location?: string
  attendees?: Array<{ email: string }>
}

interface ListEventsResponse {
  items?: CalendarEvent[]
}

interface ListCalendarsResponse {
  items?: CalendarListEntry[]
  nextPageToken?: string
}

export async function listCalendars(
  accessToken: string,
  opts: { minAccessRole?: 'freeBusyReader' | 'reader' | 'writer' | 'owner' } = {}
): Promise<CalendarListEntry[]> {
  const calendars: CalendarListEntry[] = []
  let pageToken: string | undefined

  do {
    const params = new URLSearchParams({
      maxResults: '250',
    })
    if (opts.minAccessRole) params.set('minAccessRole', opts.minAccessRole)
    if (pageToken) params.set('pageToken', pageToken)

    const res = await fetch(`${BASE}/users/me/calendarList?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) throw new Error(`Calendar listCalendars ${res.status}: ${await res.text()}`)
    const data = await res.json() as ListCalendarsResponse
    calendars.push(...(data.items ?? []))
    pageToken = data.nextPageToken
  } while (pageToken)

  return calendars
}

export async function listEvents(
  accessToken: string,
  opts: {
    calendarId?: string
    timeMin: string
    timeMax: string
    maxResults?: number
  }
): Promise<CalendarEvent[]> {
  const calendarId = encodeURIComponent(opts.calendarId ?? 'primary')
  const params = new URLSearchParams({
    timeMin: opts.timeMin,
    timeMax: opts.timeMax,
    maxResults: String(opts.maxResults ?? 20),
    singleEvents: 'true',
    orderBy: 'startTime',
  })
  const res = await fetch(`${BASE}/calendars/${calendarId}/events?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Calendar listEvents ${res.status}: ${await res.text()}`)
  const data = await res.json() as ListEventsResponse
  return data.items ?? []
}

export async function createEvent(
  accessToken: string,
  input: CalendarEventInput,
  opts: { calendarId?: string } = {}
): Promise<CalendarEvent> {
  const calendarId = encodeURIComponent(opts.calendarId ?? 'primary')
  const res = await fetch(`${BASE}/calendars/${calendarId}/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`Calendar createEvent ${res.status}: ${await res.text()}`)
  return res.json() as Promise<CalendarEvent>
}

export async function patchAttendees(
  accessToken: string,
  eventId: string,
  emails: string[],
  opts: { calendarId?: string } = {}
): Promise<CalendarEvent> {
  const calendarId = encodeURIComponent(opts.calendarId ?? 'primary')
  const existing = await fetch(`${BASE}/calendars/${calendarId}/events/${eventId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!existing.ok) throw new Error(`Calendar getEvent ${existing.status}: ${await existing.text()}`)
  const event = await existing.json() as CalendarEvent

  const currentEmails = new Set((event.attendees ?? []).map(a => a.email))
  const merged = [
    ...(event.attendees ?? []),
    ...emails.filter(e => !currentEmails.has(e)).map(email => ({ email })),
  ]

  const res = await fetch(`${BASE}/calendars/${calendarId}/events/${eventId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ attendees: merged }),
  })
  if (!res.ok) throw new Error(`Calendar patchAttendees ${res.status}: ${await res.text()}`)
  return res.json() as Promise<CalendarEvent>
}
