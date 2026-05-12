import { Hono } from 'hono'
import { getAllSettings, setSetting } from '../db/settings'
import { Layout } from './components/Layout'
import { renderPage, renderFragment } from './render'

type FieldType = 'text' | 'bool' | 'number'

interface SettingField {
  key: string
  label: string
  type: FieldType
}

const SETTING_FIELDS: SettingField[] = [
  { key: 'timezone', label: 'Timezone (IANA, e.g. America/Los_Angeles)', type: 'text' },
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

interface SettingsPageProps {
  csrfToken: string
  settings: Record<string, string>
}

function SettingsPage({ csrfToken, settings }: SettingsPageProps) {
  return (
    <Layout title="Settings" csrfToken={csrfToken} currentPath="/admin/settings">
      <h2>Settings</h2>
      <form hx-post="/admin/settings" hx-target="#save-status" hx-swap="innerHTML">
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

settingsRoutes.get('/', (c) => {
  const csrfToken = c.get('csrf_token') as string
  const settings = getAllSettings()
  return c.html(renderPage(<SettingsPage csrfToken={csrfToken} settings={settings} />))
})

settingsRoutes.post('/', async (c) => {
  const form = await c.req.formData()
  let count = 0
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
  return c.html(renderFragment(<span className="status-ok">{`Saved ${count} settings.`}</span>))
})
