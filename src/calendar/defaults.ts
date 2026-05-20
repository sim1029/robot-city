import { listCalendars, type CalendarListEntry } from './client'
import { getSetting, setSetting } from '../db/settings'
import { getValidGmailAccessToken } from '../gmail/tokens'

export const DEFAULT_CALENDAR_SETTING_KEY = 'default_calendar_id'
export const PRIMARY_CALENDAR_ID = 'primary'

export type CalendarResolution =
  | { kind: 'resolved'; calendar: CalendarListEntry }
  | { kind: 'not_found'; query: string; calendars: CalendarListEntry[] }
  | { kind: 'ambiguous'; query: string; calendars: CalendarListEntry[] }

export function getDefaultCalendarId(): string {
  return getSetting(DEFAULT_CALENDAR_SETTING_KEY, PRIMARY_CALENDAR_ID) || PRIMARY_CALENDAR_ID
}

export function setDefaultCalendarId(calendarId: string): void {
  setSetting(DEFAULT_CALENDAR_SETTING_KEY, calendarId.trim() || PRIMARY_CALENDAR_ID)
}

export function clearDefaultCalendarId(): void {
  setDefaultCalendarId(PRIMARY_CALENDAR_ID)
}

export async function listWritableCalendarsForUser(gmailUserId: string): Promise<CalendarListEntry[]> {
  const accessToken = await getValidGmailAccessToken(gmailUserId)
  return listCalendars(accessToken, { minAccessRole: 'writer' })
}

export function resolveCalendarSelection(
  calendars: CalendarListEntry[],
  query: string
): CalendarResolution {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return { kind: 'not_found', query, calendars }
  }

  const idMatch = calendars.find((c) => c.id.toLowerCase() === normalized)
  if (idMatch) return { kind: 'resolved', calendar: idMatch }

  const nameMatches = calendars.filter((c) => c.summary.trim().toLowerCase() === normalized)
  if (nameMatches.length === 1) return { kind: 'resolved', calendar: nameMatches[0] }
  if (nameMatches.length > 1) return { kind: 'ambiguous', query, calendars: nameMatches }

  return { kind: 'not_found', query, calendars }
}

export function formatCalendarList(calendars: CalendarListEntry[]): string {
  if (calendars.length === 0) return 'No writable calendars found.'
  return calendars.map((c) => `- ${formatCalendarLabel(c)} (${c.id})`).join('\n')
}

export function formatCalendarLabel(calendar: CalendarListEntry): string {
  return `${calendar.summary}${calendar.primary ? ' [primary]' : ''}`
}
