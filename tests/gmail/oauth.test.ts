import { describe, expect, test, beforeAll, afterEach, afterAll } from 'bun:test'
import { installFetchMock, uninstallFetchMock, resetFetchMock, mockFetch, fetchCalls } from '../_helpers/fetch-mock'
import { getGmailAuthUrl, exchangeGmailCode, refreshGmailAccessToken } from '../../src/gmail/oauth'

describe('gmail oauth', () => {
  beforeAll(() => {
    installFetchMock()
    process.env.GOOGLE_CLIENT_ID = 'test-client'
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret'
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/auth/google/callback'
  })
  afterEach(() => resetFetchMock())
  afterAll(() => uninstallFetchMock())

  test('getGmailAuthUrl includes scopes, offline access, and consent prompt', () => {
    const url = new URL(getGmailAuthUrl('state-abc'))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe('test-client')
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/auth/google/callback')
    expect(url.searchParams.get('state')).toBe('state-abc')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    const scope = url.searchParams.get('scope') ?? ''
    expect(scope).toContain('https://www.googleapis.com/auth/gmail.modify')
    expect(scope).toContain('https://www.googleapis.com/auth/gmail.send')
    expect(scope).toContain('https://www.googleapis.com/auth/userinfo.email')
  })

  test('exchangeGmailCode posts form-encoded body and returns tokens', async () => {
    mockFetch('https://oauth2.googleapis.com/token', {
      json: { access_token: 'A', refresh_token: 'R', expires_in: 3599, scope: 'gmail.modify', token_type: 'Bearer' },
    })
    const tokens = await exchangeGmailCode('the-code')
    expect(tokens.access_token).toBe('A')
    expect(tokens.refresh_token).toBe('R')
    expect(tokens.expires_in).toBe(3599)

    const call = fetchCalls()[0]
    expect(call.method).toBe('POST')
    expect(call.headers['content-type']).toBe('application/x-www-form-urlencoded')
    const params = new URLSearchParams(call.body!)
    expect(params.get('grant_type')).toBe('authorization_code')
    expect(params.get('code')).toBe('the-code')
    expect(params.get('client_id')).toBe('test-client')
    expect(params.get('client_secret')).toBe('test-secret')
    expect(params.get('redirect_uri')).toBe('http://localhost:3000/auth/google/callback')
  })

  test('refreshGmailAccessToken returns new access token', async () => {
    mockFetch('https://oauth2.googleapis.com/token', {
      json: { access_token: 'A2', expires_in: 3599, scope: 'gmail.modify', token_type: 'Bearer' },
    })
    const result = await refreshGmailAccessToken('the-refresh')
    expect(result.access_token).toBe('A2')
    expect(result.expires_in).toBe(3599)
    const params = new URLSearchParams(fetchCalls()[0].body!)
    expect(params.get('grant_type')).toBe('refresh_token')
    expect(params.get('refresh_token')).toBe('the-refresh')
  })

  test('exchangeGmailCode throws with status + body on failure', async () => {
    mockFetch('https://oauth2.googleapis.com/token', { status: 400, text: 'invalid_grant' })
    expect(exchangeGmailCode('bad')).rejects.toThrow(/400.*invalid_grant/)
  })
})
