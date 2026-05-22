import { Hono } from 'hono'
import { getAllSettings, setSetting } from '../db/settings'
import { Layout } from './components/Layout'
import { renderPage, renderFragment } from './render'
import { db } from '../db/client'
import { formatCalendarLabel, listWritableCalendarsForUser, PRIMARY_CALENDAR_ID } from '../calendar/defaults'
import type { CalendarListEntry } from '../calendar/client'
import { normalizeTimezoneValue, timezoneOptions, validateTimezone } from '../timezones'

type FieldType = 'text' | 'bool' | 'number'

interface SettingField {
  key: string
  label: string
  type: FieldType
}

const SETTING_FIELDS: SettingField[] = [
  { key: 'brief_morning_enabled', label: 'Morning brief enabled', type: 'bool' },
  { key: 'brief_morning_hour', label: 'Morning brief hour (0-23, local time)', type: 'number' },
  { key: 'brief_midday_enabled', label: 'Midday brief enabled', type: 'bool' },
  { key: 'brief_midday_hour', label: 'Midday brief hour', type: 'number' },
  { key: 'brief_evening_enabled', label: 'Evening brief enabled', type: 'bool' },
  { key: 'brief_evening_hour', label: 'Evening brief hour', type: 'number' },
]

interface FieldRowProps {
  field: SettingField
  value: string
}

function FieldRow({ field, value }: FieldRowProps) {
  if (field.type === 'bool') {
    return (
      <div className="field">
        <label>
          <input type="checkbox" name={field.key} value="true" defaultChecked={value === 'true'} />
          {' '}{field.label}
        </label>
      </div>
    )
  }
  const inputType = field.type === 'number' ? 'number' : 'text'
  return (
    <div className="field">
      <label htmlFor={`f-${field.key}`}>{field.label}</label>
      <input id={`f-${field.key}`} type={inputType} name={field.key} defaultValue={value} />
    </div>
  )
}

function TimezoneField({ value }: { value: string }) {
  const normalizedValue = normalizeTimezoneValue(value || 'UTC')
  const options = timezoneOptions()

  return (
    <div className="field">
      <label htmlFor="f-timezone">Timezone</label>
      <input
        id="f-timezone"
        className="timezone-search"
        type="search"
        name="timezone"
        list="timezone-options"
        defaultValue={normalizedValue}
        placeholder="Search timezones"
        autoComplete="off"
      />
      <datalist id="timezone-options">
        {options.map((option) => (
          <option key={option.value} value={option.value} label={option.popular ? `Popular - ${option.label}` : option.label} />
        ))}
      </datalist>
      <p className="field-help">Search by city or region. Common timezones appear first.</p>
    </div>
  )
}

interface SettingsPageProps {
  csrfToken: string
  settings: Record<string, string>
  calendars: CalendarListEntry[]
  calendarError?: string
}

function CalendarField({
  value,
  calendars,
  error,
}: {
  value: string
  calendars: CalendarListEntry[]
  error?: string
}) {
  const options = [
    { id: PRIMARY_CALENDAR_ID, summary: 'Primary calendar', primary: true },
    ...calendars.filter((c) => c.id !== PRIMARY_CALENDAR_ID),
  ]

  if (calendars.length === 0) {
    return (
      <div className="field">
        <label htmlFor="f-default_calendar_id">Default calendar for new events</label>
        <input id="f-default_calendar_id" type="text" name="default_calendar_id" defaultValue={value || PRIMARY_CALENDAR_ID} />
        {error ? <p className="field-help status-err">{error}</p> : <p className="field-help">Connect Google to choose from writable calendars.</p>}
      </div>
    )
  }

  return (
    <div className="field">
      <label htmlFor="f-default_calendar_id">Default calendar for new events</label>
      <select id="f-default_calendar_id" name="default_calendar_id" defaultValue={value || PRIMARY_CALENDAR_ID}>
        {options.map((calendar) => (
          <option key={calendar.id} value={calendar.id}>{`${formatCalendarLabel(calendar)} (${calendar.id})`}</option>
        ))}
      </select>
      {error ? <p className="field-help status-err">{error}</p> : null}
    </div>
  )
}

function SettingsPage({ csrfToken, settings, calendars, calendarError }: SettingsPageProps) {
  return (
    <Layout title="Settings" csrfToken={csrfToken} currentPath="/admin/settings">
      <h2>Settings</h2>
      <form hx-post="/admin/settings" hx-target="#save-status" hx-swap="innerHTML">
        <CalendarField
          value={settings.default_calendar_id ?? PRIMARY_CALENDAR_ID}
          calendars={calendars}
          error={calendarError}
        />
        <TimezoneField value={settings.timezone ?? 'UTC'} />
        {SETTING_FIELDS.map((f) => (
          <FieldRow key={f.key} field={f} value={settings[f.key] ?? ''} />
        ))}
        <div className="actions">
          <button type="submit" className="btn-primary">Save</button>
          <span id="save-status" className="status" />
        </div>
      </form>
    </Layout>
  )
}

export const settingsRoutes = new Hono()

settingsRoutes.get('/', async (c) => {
  const csrfToken = c.get('csrf_token') as string
  const settings = getAllSettings()
  const { calendars, error } = await loadWritableCalendars()
  return c.html(renderPage(<SettingsPage csrfToken={csrfToken} settings={settings} calendars={calendars} calendarError={error} />))
})

settingsRoutes.post('/', async (c) => {
  const form = await c.req.formData()
  const defaultCalendar = String(form.get('default_calendar_id') ?? PRIMARY_CALENDAR_ID).trim() || PRIMARY_CALENDAR_ID
  const validation = await validateDefaultCalendar(defaultCalendar)
  if (!validation.ok) {
    return c.html(renderFragment(<span className="status-err">{validation.error}</span>))
  }
  setSetting('default_calendar_id', defaultCalendar)

  let count = 0
  const timezone = validateTimezone(String(form.get('timezone') ?? ''))
  if (!timezone.ok) {
    return c.html(renderFragment(<span className="status-err">{timezone.error}</span>))
  }
  setSetting('timezone', timezone.value)
  count++

  for (const f of SETTING_FIELDS) {
    if (f.type === 'bool') {
      const val = form.get(f.key) ? 'true' : 'false'
      setSetting(f.key, val)
      count++
    } else {
      const raw = form.get(f.key)
      if (raw !== null) {
        setSetting(f.key, String(raw))
        count++
      }
    }
  }
  return c.html(renderFragment(<span className="status-ok">{`Saved ${count + 1} settings.`}</span>))
})

async function loadWritableCalendars(): Promise<{ calendars: CalendarListEntry[]; error?: string }> {
  const gmailRow = db.query('SELECT user_id FROM gmail_tokens LIMIT 1').get() as { user_id: string } | null
  if (!gmailRow) return { calendars: [] }

  try {
    return { calendars: await listWritableCalendarsForUser(gmailRow.user_id) }
  } catch (err) {
    return {
      calendars: [],
      error: `Unable to list calendars. Reconnect Google at /auth/google. ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

async function validateDefaultCalendar(calendarId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (calendarId === PRIMARY_CALENDAR_ID) return { ok: true }

  const gmailRow = db.query('SELECT user_id FROM gmail_tokens LIMIT 1').get() as { user_id: string } | null
  if (!gmailRow) {
    return { ok: false, error: 'Connect Google before selecting a non-primary default calendar.' }
  }

  try {
    const calendars = await listWritableCalendarsForUser(gmailRow.user_id)
    if (calendars.some((c) => c.id === calendarId)) return { ok: true }
    return { ok: false, error: 'Selected calendar was not found in writable Google calendars.' }
  } catch (err) {
    return {
      ok: false,
      error: `Unable to validate calendars. Reconnect Google at /auth/google. ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
