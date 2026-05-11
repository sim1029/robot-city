import { listEvents, type CalendarEvent } from '../calendar/client'

export async function readCalendar(
  accessToken: string,
  opts: { date?: string; days?: number } = {}
): Promise<string> {
  const days = opts.days ?? 1
  const startDate = opts.date ? new Date(opts.date) : startOfDay(new Date())
  const endDate = new Date(startDate)
  endDate.setDate(endDate.getDate() + days)

  const events = await listEvents(accessToken, {
    timeMin: startDate.toISOString(),
    timeMax: endDate.toISOString(),
    maxResults: 20,
  })

  if (events.length === 0) return 'No calendar events found for this period.'
  return events.map(formatEvent).join('\n')
}

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

function formatEvent(e: CalendarEvent): string {
  const title = e.summary ?? '(no title)'
  const time = formatTime(e)
  const location = e.location ? ` @ ${e.location}` : ''
  const attendees = e.attendees?.length
    ? ` — ${e.attendees.map(a => a.email).join(', ')}`
    : ''
  return `• ${title} [${time}]${location}${attendees} (id: ${e.id})`
}

function formatTime(e: CalendarEvent): string {
  if (e.start.date) return e.start.date
  const start = e.start.dateTime ? new Date(e.start.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '?'
  const end = e.end.dateTime ? new Date(e.end.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '?'
  return `${start}–${end}`
}
