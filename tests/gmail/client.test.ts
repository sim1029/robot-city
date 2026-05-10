import { describe, expect, test, beforeAll, afterEach, afterAll } from 'bun:test'
import { installFetchMock, uninstallFetchMock, resetFetchMock, mockFetch, fetchCalls } from '../_helpers/fetch-mock'
import {
  listHistory,
  getMessage,
  sendMessage,
  getProfile,
  GmailHistoryGoneError,
  buildRfc822,
  base64url,
  parseHeaders,
} from '../../src/gmail/client'

const TOKEN = 'access-xyz'

describe('gmail client — pure helpers', () => {
  test('base64url encodes without padding and uses url-safe alphabet', () => {
    const enc = base64url('hello??>>')
    expect(enc).not.toContain('=')
    expect(enc).not.toContain('+')
    expect(enc).not.toContain('/')
  })

  test('buildRfc822 includes headers and body in CRLF form', () => {
    const raw = buildRfc822({ to: 'a@b.com', subject: 'hi', body: 'line1\nline2' })
    expect(raw).toContain('To: a@b.com\r\n')
    expect(raw).toContain('Subject: hi\r\n')
    expect(raw).toContain('MIME-Version: 1.0\r\n')
    expect(raw).toContain('Content-Type: text/plain; charset="UTF-8"\r\n')
    expect(raw.endsWith('line1\r\nline2')).toBe(true)
  })

  test('parseHeaders extracts From/Subject/Date', () => {
    const headers = [
      { name: 'From', value: 'a@b.com' },
      { name: 'Subject', value: 'Hi there' },
      { name: 'Date', value: 'Mon, 1 Jan 2026 00:00:00 +0000' },
    ]
    const parsed = parseHeaders(headers)
    expect(parsed.from).toBe('a@b.com')
    expect(parsed.subject).toBe('Hi there')
    expect(parsed.date).toBe('Mon, 1 Jan 2026 00:00:00 +0000')
  })
})

describe('gmail client — http calls', () => {
  beforeAll(() => installFetchMock())
  afterEach(() => resetFetchMock())
  afterAll(() => uninstallFetchMock())

  test('listHistory passes startHistoryId and bearer token', async () => {
    mockFetch(/users\/me\/history/, {
      json: { history: [{ id: '101', messagesAdded: [{ message: { id: 'm1', threadId: 't1' } }] }], historyId: '101' },
    })
    const result = await listHistory(TOKEN, '100')
    expect(result.historyId).toBe('101')
    const call = fetchCalls()[0]
    expect(call.url).toContain('startHistoryId=100')
    expect(call.headers['authorization']).toBe(`Bearer ${TOKEN}`)
  })

  test('listHistory throws GmailHistoryGoneError on 404', async () => {
    mockFetch(/users\/me\/history/, { status: 404, json: { error: { code: 404 } } })
    expect(listHistory(TOKEN, '1')).rejects.toBeInstanceOf(GmailHistoryGoneError)
  })

  test('getMessage returns parsed snippet + headers', async () => {
    mockFetch(/users\/me\/messages\/m1/, {
      json: {
        id: 'm1',
        threadId: 't1',
        snippet: 'Hello world',
        payload: {
          headers: [
            { name: 'From', value: 'sender@example.com' },
            { name: 'Subject', value: 'Re: meeting' },
            { name: 'Date', value: 'Mon, 1 Jan 2026 00:00:00 +0000' },
          ],
        },
      },
    })
    const msg = await getMessage(TOKEN, 'm1')
    expect(msg.id).toBe('m1')
    expect(msg.snippet).toBe('Hello world')
    expect(msg.headers.from).toBe('sender@example.com')
    expect(msg.headers.subject).toBe('Re: meeting')
  })

  test('getProfile returns historyId', async () => {
    mockFetch(/users\/me\/profile/, { json: { emailAddress: 'me@x.com', historyId: '999' } })
    const p = await getProfile(TOKEN)
    expect(p.historyId).toBe('999')
    expect(p.emailAddress).toBe('me@x.com')
  })

  test('sendMessage posts base64url-encoded raw message and returns id', async () => {
    mockFetch(/users\/me\/messages\/send/, { json: { id: 'sent-1', threadId: 'th-1' } })
    const result = await sendMessage(TOKEN, { to: 'a@b.com', subject: 'hi', body: 'hello' })
    expect(result.id).toBe('sent-1')
    const call = fetchCalls()[0]
    expect(call.method).toBe('POST')
    const json = call.bodyJson() as { raw: string }
    expect(json.raw).toBeTruthy()
    expect(json.raw).not.toContain('=')
    expect(json.raw).not.toContain('+')
    expect(json.raw).not.toContain('/')
    const decoded = Buffer.from(json.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
    expect(decoded).toContain('To: a@b.com')
    expect(decoded).toContain('Subject: hi')
    expect(decoded).toContain('hello')
  })
})
