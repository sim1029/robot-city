import type { CalendarEvent, CalendarListEntry } from '../calendar/client'
import type { CalendarRequestTrace, CalendarWorldFixture } from './types'

export class CalendarWorld {
  readonly calendars: CalendarListEntry[]
  readonly events: CalendarEvent[]
  readonly requests: CalendarRequestTrace[] = []
  private nextEventNumber = 1

  constructor(fixture: CalendarWorldFixture) {
    this.calendars = structuredClone(fixture.calendars)
    this.events = structuredClone(fixture.events)
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const body = request.method === 'GET' ? undefined : await request.json().catch(() => undefined) as Record<string, unknown> | undefined
    this.requests.push({ method: request.method, path, body })

    if (path === '/calendar/v3/users/me/calendarList') {
      return json({ items: this.calendars })
    }

    const match = /^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(path)
    if (!match) return json({ error: 'unsupported fake calendar path' }, 404)
    const calendarId = decodeURIComponent(match[1])
    const eventId = match[2] ? decodeURIComponent(match[2]) : undefined

    if (!eventId && request.method === 'GET') {
      return json({ items: this.events.filter(event => (event as CalendarEvent & { calendarId?: string }).calendarId === calendarId || calendarId === 'primary') })
    }

    if (!eventId && request.method === 'POST') {
      const input = body ?? {}
      const id = `eval-event-${this.nextEventNumber++}`
      const event = {
        id,
        summary: String(input.summary ?? ''),
        description: stringOrUndefined(input.description),
        location: stringOrUndefined(input.location),
        start: input.start as CalendarEvent['start'],
        end: input.end as CalendarEvent['end'],
        attendees: Array.isArray(input.attendees) ? input.attendees as CalendarEvent['attendees'] : undefined,
        htmlLink: `https://calendar.example.test/events/${id}`,
        calendarId,
      } as CalendarEvent
      this.events.push(event)
      return json(event)
    }

    const event = this.events.find(item => item.id === eventId)
    if (!event) return json({ error: 'event not found' }, 404)
    if (request.method === 'GET') return json(event)
    if (request.method === 'PATCH') {
      Object.assign(event, body ?? {})
      return json(event)
    }
    return json({ error: 'unsupported fake calendar request' }, 405)
  }

  createdEvents(): CalendarEvent[] {
    return this.events.filter(event => event.id.startsWith('eval-event-'))
  }
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
