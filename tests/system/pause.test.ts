import { describe, expect, test, beforeAll, beforeEach, afterEach, afterAll } from 'bun:test'
import { installFetchMock, uninstallFetchMock, resetFetchMock, fetchCalls } from '../_helpers/fetch-mock'
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
  })
  beforeEach(() => {
    db.run("DELETE FROM user_settings WHERE key = 'paused'")
  })

  test('non-owner is rejected', () => {
    const result = handleSlashCommand({ name: 'pause', userId: 'someone-else' })
    expect(result.content).toContain('Only the configured owner')
    expect(isPaused()).toBe(false)
  })

  test('/pause sets paused, /resume clears it', () => {
    const p = handleSlashCommand({ name: 'pause', userId: OWNER })
    expect(p.content).toContain('Paused')
    expect(isPaused()).toBe(true)

    const r = handleSlashCommand({ name: 'resume', userId: OWNER })
    expect(r.content).toContain('Resumed')
    expect(isPaused()).toBe(false)
  })

  test('/status reflects current state', () => {
    setPaused(true, 'admin')
    expect(handleSlashCommand({ name: 'status', userId: OWNER }).content).toContain('Paused')
    setPaused(false, 'admin')
    expect(handleSlashCommand({ name: 'status', userId: OWNER }).content).toContain('Active')
  })
})
