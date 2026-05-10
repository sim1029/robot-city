import { describe, expect, test, beforeAll, afterEach, afterAll } from 'bun:test'
import { installFetchMock, uninstallFetchMock, resetFetchMock, mockFetch, fetchCalls } from './fetch-mock'

describe('fetch-mock', () => {
  beforeAll(() => installFetchMock())
  afterEach(() => resetFetchMock())
  afterAll(() => uninstallFetchMock())

  test('matches by exact URL and returns JSON', async () => {
    mockFetch('https://example.com/api', { json: { ok: true } })
    const res = await fetch('https://example.com/api')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test('returns custom status and text', async () => {
    mockFetch(/\/missing$/, { status: 404, text: 'gone' })
    const res = await fetch('https://example.com/missing')
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('gone')
  })

  test('records calls with parsed body', async () => {
    mockFetch('https://example.com/post', { json: {} })
    await fetch('https://example.com/post', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    })
    const calls = fetchCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].bodyJson()).toEqual({ hello: 'world' })
  })

  test('throws on unmatched URL', async () => {
    expect(fetch('https://example.com/nope')).rejects.toThrow(/no stub matched/)
  })
})
