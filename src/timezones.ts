const intlWithSupportedValues = Intl as typeof Intl & {
  supportedValuesOf?: (key: 'timeZone') => string[]
}

export const POPULAR_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
] as const

const LEGACY_TIMEZONE_ALIASES: Record<string, string> = {
  EST: 'America/New_York',
  EDT: 'America/New_York',
  CST: 'America/Chicago',
  CDT: 'America/Chicago',
  MST: 'America/Denver',
  MDT: 'America/Denver',
  PST: 'America/Los_Angeles',
  PDT: 'America/Los_Angeles',
  'US/Eastern': 'America/New_York',
  'US/Central': 'America/Chicago',
  'US/Mountain': 'America/Denver',
  'US/Pacific': 'America/Los_Angeles',
}

export interface TimezoneOption {
  value: string
  label: string
  popular: boolean
}

export function normalizeTimezoneValue(raw: string): string {
  const trimmed = raw.trim()
  return LEGACY_TIMEZONE_ALIASES[trimmed] ?? trimmed
}

export function supportedTimezones(): string[] {
  const supported = intlWithSupportedValues.supportedValuesOf?.('timeZone') ?? []
  return [...new Set(['UTC', ...supported])].sort((a, b) => a.localeCompare(b))
}

export function timezoneOptions(now = new Date()): TimezoneOption[] {
  const supported = supportedTimezones()
  const popular = POPULAR_TIMEZONES.filter((tz) => supported.includes(tz))
  const rest = supported.filter((tz) => !popular.includes(tz as (typeof POPULAR_TIMEZONES)[number]))

  return [
    ...popular.map((tz) => ({ value: tz, label: timezoneLabel(tz, now), popular: true })),
    ...rest.map((tz) => ({ value: tz, label: timezoneLabel(tz, now), popular: false })),
  ]
}

export function validateTimezone(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = normalizeTimezoneValue(raw)
  if (!value) return { ok: false, error: 'Choose a timezone.' }
  if (!supportedTimezones().includes(value)) {
    return { ok: false, error: 'Choose a timezone from the list.' }
  }

  return { ok: true, value }
}

function timezoneLabel(timezone: string, now: Date): string {
  const offset = timezoneOffsetLabel(timezone, now)
  const city = timezone.split('/').pop()?.replace(/_/g, ' ') ?? timezone
  return `${offset} - ${city} (${timezone})`
}

function timezoneOffsetLabel(timezone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'shortOffset',
  }).formatToParts(now)
  const value = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
  return value.replace('GMT', 'UTC')
}
