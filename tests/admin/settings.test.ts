import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { db } from '../../src/db/client'
import { migrate } from '../../src/db/schema'
import { settingsRoutes } from '../../src/admin/settings'

describe('admin settings', () => {
  beforeAll(() => migrate())
  beforeEach(() => {
    db.run('DELETE FROM gmail_tokens')
    db.run("DELETE FROM user_settings WHERE key = 'default_calendar_id'")
    db.run("UPDATE user_settings SET value = 'UTC' WHERE key = 'timezone'")
  })

  test('invalid default calendar validation returns 2xx HTMX fragment', async () => {
    const app = new Hono()
    app.use('*', async (c, next) => {
      c.set('csrf_token', 'test-csrf')
      await next()
    })
    app.route('/admin/settings', settingsRoutes)

    const form = new FormData()
    form.set('default_calendar_id', 'team@example.com')

    const res = await app.request('/admin/settings', { method: 'POST', body: form })
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(body).toContain('status-err')
    expect(body).toContain('Connect Google')
  })

  test('renders a searchable timezone list with common zones first', async () => {
    const app = new Hono()
    app.use('*', async (c, next) => {
      c.set('csrf_token', 'test-csrf')
      await next()
    })
    app.route('/admin/settings', settingsRoutes)

    const res = await app.request('/admin/settings')
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(body).toContain('type="search"')
    expect(body).toContain('list="timezone-options"')
    expect(body.indexOf('value="America/New_York"')).toBeLessThan(body.indexOf('value="Africa/Abidjan"'))
  })

  test('normalizes EST timezone submissions to America/New_York', async () => {
    const app = new Hono()
    app.use('*', async (c, next) => {
      c.set('csrf_token', 'test-csrf')
      await next()
    })
    app.route('/admin/settings', settingsRoutes)

    const form = new FormData()
    form.set('default_calendar_id', 'primary')
    form.set('timezone', 'EST')
    form.set('brief_morning_hour', '8')
    form.set('brief_midday_hour', '12')
    form.set('brief_evening_hour', '18')

    const res = await app.request('/admin/settings', { method: 'POST', body: form })
    const body = await res.text()
    const row = db.query("SELECT value FROM user_settings WHERE key = 'timezone'").get() as { value: string }

    expect(res.status).toBe(200)
    expect(body).toContain('status-ok')
    expect(row.value).toBe('America/New_York')
  })

  test('migration repairs existing EST setting', () => {
    db.run("UPDATE user_settings SET value = 'EST' WHERE key = 'timezone'")

    migrate()

    const row = db.query("SELECT value FROM user_settings WHERE key = 'timezone'").get() as { value: string }
    expect(row.value).toBe('America/New_York')
  })

  test('rejects timezone submissions outside the list', async () => {
    const app = new Hono()
    app.use('*', async (c, next) => {
      c.set('csrf_token', 'test-csrf')
      await next()
    })
    app.route('/admin/settings', settingsRoutes)

    const form = new FormData()
    form.set('default_calendar_id', 'primary')
    form.set('timezone', 'GMT-5')

    const res = await app.request('/admin/settings', { method: 'POST', body: form })
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(body).toContain('status-err')
    expect(body).toContain('Choose a timezone from the list')
  })
})
