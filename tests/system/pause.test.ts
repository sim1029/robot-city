import { describe, expect, test, beforeAll, beforeEach, afterEach, afterAll } from 'bun:test'
import { installFetchMock, uninstallFetchMock, resetFetchMock, fetchCalls, mockFetch } from '../_helpers/fetch-mock'
import { db } from '../../src/db/client'
import { migrate } from '../../src/db/schema'
import { isPaused, setPaused } from '../../src/system/pause'
import { runTriageTick } from '../../src/gmail/triage_loop'
import { handleSlashCommand } from '../../src/discord/slash_commands'

describe('pause state', () => {
  beforeAll(() => {
    migrate()
  })
  beforeEach(() => {
    db.run("DELETE FROM user_settings WHERE key = 'paused'")
  })

  test('defaults to not paused', () => {
    expect(isPaused()).toBe(false)
  })

  test('setPaused round-trips', () => {
    setPaused(true, 'admin')
    expect(isPaused()).toBe(true)
    setPaused(false, 'admin')
    expect(isPaused()).toBe(false)
  })
})

describe('runTriageTick when paused', () => {
  beforeAll(() => {
    migrate()
    installFetchMock()
  })
  beforeEach(() => {
    db.run("DELETE FROM user_settings WHERE key = 'paused'")
  })
  afterEach(() => resetFetchMock())
  afterAll(() => uninstallFetchMock())

  test('early-returns without any fetch when paused', async () => {
    setPaused(true, 'admin')

    const result = await runTriageTick({
      gmailUserId: 'me@example.com',
      discordUserId: 'discord-user',
    })

    expect(result).toEqual({
      pollKind: 'paused',
      triaged: 0,
      notified: 0,
      approvalsRequested: 0,
    })
    expect(fetchCalls()).toHaveLength(0)
  })
})

describe('handleSlashCommand', () => {
  const OWNER = '999000111'

  beforeAll(() => {
    migrate()
    process.env.OWNER_DISCORD_ID = OWNER
    process.env.GOOGLE_CLIENT_ID = 'test-client'
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret'
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/auth/google/callback'
    installFetchMock()
  })
  beforeEach(() => {
    db.run("DELETE FROM user_settings WHERE key = 'paused'")
    db.run("DELETE FROM user_settings WHERE key = 'default_calendar_id'")
    db.run('DELETE FROM gmail_tokens')
    resetFetchMock()
  })
  afterAll(() => uninstallFetchMock())

  test('non-owner is rejected', async () => {
    const result = await handleSlashCommand({ name: 'pause', userId: 'someone-else' })
    expect(result.content).toContain('Only the configured owner')
    expect(isPaused()).toBe(false)
  })

  test('/pause sets paused, /resume clears it', async () => {
    const p = await handleSlashCommand({ name: 'pause', userId: OWNER })
    expect(p.content).toContain('Paused')
    expect(isPaused()).toBe(true)

    const r = await handleSlashCommand({ name: 'resume', userId: OWNER })
    expect(r.content).toContain('Resumed')
    expect(isPaused()).toBe(false)
  })

  test('/status reflects current state', async () => {
    setPaused(true, 'admin')
    expect((await handleSlashCommand({ name: 'status', userId: OWNER })).content).toContain('Paused')
    setPaused(false, 'admin')
    expect((await handleSlashCommand({ name: 'status', userId: OWNER })).content).toContain('Active')
  })

  test('/calendar-default rejects non-owner', async () => {
    const result = await handleSlashCommand({
      name: 'calendar-default',
      userId: 'someone-else',
      subcommand: 'show',
    })

    expect(result.content).toContain('Only the configured owner')
  })

  test('/calendar-default show and clear use primary fallback', async () => {
    db.run("INSERT INTO user_settings (key, value) VALUES ('default_calendar_id', 'work@example.com')")

    expect((await handleSlashCommand({ name: 'calendar-default', userId: OWNER, subcommand: 'show' })).content).toContain('work@example.com')

    const cleared = await handleSlashCommand({ name: 'calendar-default', userId: OWNER, subcommand: 'clear' })
    expect(cleared.content).toContain('primary')
    expect((await handleSlashCommand({ name: 'calendar-default', userId: OWNER, subcommand: 'show' })).content).toContain('primary')

    db.run("UPDATE user_settings SET value = 'work@example.com' WHERE key = 'default_calendar_id'")
    const setPrimary = await handleSlashCommand({ name: 'calendar-default', userId: OWNER, subcommand: 'set', calendar: 'primary' })
    expect(setPrimary.content).toContain('primary')
    expect((await handleSlashCommand({ name: 'calendar-default', userId: OWNER, subcommand: 'show' })).content).toContain('primary')
  })

  test('/calendar-default list and set exact name or ID', async () => {
    db.run(
      `INSERT INTO gmail_tokens (user_id, access_token, refresh_token, expires_at, scope) VALUES ('me@example.com', 'tok', 'ref', ?, 'calendar')`,
      [Date.now() + 3_600_000]
    )
    mockFetch(/users\/me\/calendarList/, {
      json: {
        items: [
          { id: 'me@example.com', summary: 'Personal', primary: true, accessRole: 'owner' },
          { id: 'work@example.com', summary: 'Work', accessRole: 'writer' },
        ],
      },
    })
    mockFetch(/users\/me\/calendarList/, {
      json: {
        items: [
          { id: 'me@example.com', summary: 'Personal', primary: true, accessRole: 'owner' },
          { id: 'work@example.com', summary: 'Work', accessRole: 'writer' },
        ],
      },
    })

    const listed = await handleSlashCommand({ name: 'calendar-default', userId: OWNER, subcommand: 'list' })
    expect(listed.content).toContain('Work')
    expect(listed.content).toContain('work@example.com')

    const set = await handleSlashCommand({
      name: 'calendar-default',
      userId: OWNER,
      subcommand: 'set',
      calendar: 'Work',
    })
    expect(set.content).toContain('work@example.com')
    expect((await handleSlashCommand({ name: 'calendar-default', userId: OWNER, subcommand: 'show' })).content).toContain('work@example.com')
  })

  test('/calendar-default set reports ambiguous calendar names', async () => {
    db.run(
      `INSERT INTO gmail_tokens (user_id, access_token, refresh_token, expires_at, scope) VALUES ('me@example.com', 'tok', 'ref', ?, 'calendar')`,
      [Date.now() + 3_600_000]
    )
    mockFetch(/users\/me\/calendarList/, {
      json: {
        items: [
          { id: 'a@example.com', summary: 'Projects', accessRole: 'writer' },
          { id: 'b@example.com', summary: 'Projects', accessRole: 'writer' },
        ],
      },
    })

    const result = await handleSlashCommand({
      name: 'calendar-default',
      userId: OWNER,
      subcommand: 'set',
      calendar: 'Projects',
    })

    expect(result.content).toContain('Multiple calendars matched')
    expect(result.content).toContain('a@example.com')
    expect(result.content).toContain('b@example.com')
  })
})
