import { Hono } from 'hono'
import { getAllSettings, setSetting } from '../db/settings'
import { layout, esc } from './layout'

const SETTING_FIELDS: Array<{ key: string; label: string; type: 'text' | 'bool' | 'number' }> = [
  { key: 'timezone', label: 'Timezone (IANA, e.g. America/Los_Angeles)', type: 'text' },
  { key: 'brief_morning_enabled', label: 'Morning brief enabled', type: 'bool' },
  { key: 'brief_morning_hour', label: 'Morning brief hour (0-23, local time)', type: 'number' },
  { key: 'brief_midday_enabled', label: 'Midday brief enabled', type: 'bool' },
  { key: 'brief_midday_hour', label: 'Midday brief hour', type: 'number' },
  { key: 'brief_evening_enabled', label: 'Evening brief enabled', type: 'bool' },
  { key: 'brief_evening_hour', label: 'Evening brief hour', type: 'number' },
]

export const settingsRoutes = new Hono()

settingsRoutes.get('/', (c) => {
  const csrfToken = c.get('csrf_token') as string
  const settings = getAllSettings()

  const fields = SETTING_FIELDS.map((f) => {
    const value = settings[f.key] ?? ''
    if (f.type === 'bool') {
      const checked = value === 'true' ? 'checked' : ''
      return `
        <div class="field">
          <label>
            <input type="checkbox" name="${esc(f.key)}" value="true" ${checked}>
            ${esc(f.label)}
          </label>
        </div>`
    }
    const inputType = f.type === 'number' ? 'number' : 'text'
    return `
      <div class="field">
        <label for="f-${esc(f.key)}">${esc(f.label)}</label>
        <input id="f-${esc(f.key)}" type="${inputType}" name="${esc(f.key)}" value="${esc(value)}">
      </div>`
  }).join('')

  const body = `
    <h2>Settings</h2>
    <form hx-post="/admin/settings" hx-target="#save-status" hx-swap="innerHTML">
      ${fields}
      <div class="actions">
        <button type="submit" class="btn-primary">Save</button>
        <span id="save-status" class="status"></span>
      </div>
    </form>
  `

  return c.html(layout({ title: 'Settings', csrfToken, body, currentPath: '/admin/settings' }))
})

settingsRoutes.post('/', async (c) => {
  const form = await c.req.formData()
  const updates: Array<[string, string]> = []
  for (const f of SETTING_FIELDS) {
    if (f.type === 'bool') {
      const val = form.get(f.key) ? 'true' : 'false'
      setSetting(f.key, val)
      updates.push([f.key, val])
    } else {
      const raw = form.get(f.key)
      if (raw !== null) {
        const val = String(raw)
        setSetting(f.key, val)
        updates.push([f.key, val])
      }
    }
  }
  return c.html(`<span class="status-ok">Saved ${updates.length} settings.</span>`)
})
