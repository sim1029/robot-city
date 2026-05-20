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
})
