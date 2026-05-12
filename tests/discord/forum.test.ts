import { describe, expect, test, beforeAll, beforeEach, afterEach, afterAll } from 'bun:test'
import { installFetchMock, uninstallFetchMock, resetFetchMock, mockFetch, fetchCalls } from '../_helpers/fetch-mock'
import { db } from '../../src/db/client'
import { migrate } from '../../src/db/schema'
import { resolveForumChannel, getResolvedForumId, _resetResolvedForumForTests } from '../../src/discord/forum'

describe('discord forum resolution', () => {
  beforeAll(() => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token'
    migrate()
    installFetchMock()
  })
  beforeEach(() => {
    db.run('DELETE FROM discord_tokens')
    delete process.env.DISCORD_FORUM_NAME
    delete process.env.DISCORD_GUILD_ID
    _resetResolvedForumForTests()
  })
  afterEach(() => resetFetchMock())
  afterAll(() => uninstallFetchMock())

  test('uses DISCORD_GUILD_ID env over DB row', async () => {
    process.env.DISCORD_GUILD_ID = 'env-guild'
    db.run(
      `INSERT INTO discord_tokens (user_id, access_token, refresh_token, expires_at, guild_id)
       VALUES ('u', 'a', 'r', 0, 'db-guild')`,
    )
    mockFetch(/\/guilds\/env-guild\/channels$/, {
      json: [{ id: 'forum-id', name: 'robot-city', type: 15 }],
    })

    const resolved = await resolveForumChannel()
    expect(resolved.guildId).toBe('env-guild')
    expect(resolved.forumId).toBe('forum-id')
    expect(resolved.forumName).toBe('robot-city')
  })

  test('falls back to DB guild_id when env var unset', async () => {
    db.run(
      `INSERT INTO discord_tokens (user_id, access_token, refresh_token, expires_at, guild_id)
       VALUES ('u', 'a', 'r', 0, 'db-guild')`,
    )
    mockFetch(/\/guilds\/db-guild\/channels$/, {
      json: [{ id: 'forum-id', name: 'robot-city', type: 15 }],
    })

    const resolved = await resolveForumChannel()
    expect(resolved.guildId).toBe('db-guild')
  })

  test('throws when neither env nor DB has guild id', async () => {
    await expect(resolveForumChannel()).rejects.toThrow(/guild ID/)
  })

  test('uses DISCORD_FORUM_NAME env when set', async () => {
    process.env.DISCORD_GUILD_ID = 'g'
    process.env.DISCORD_FORUM_NAME = 'robot-city-dev'
    mockFetch(/\/guilds\/g\/channels$/, {
      json: [
        { id: 'prod-forum', name: 'robot-city', type: 15 },
        { id: 'dev-forum', name: 'robot-city-dev', type: 15 },
      ],
    })

    const resolved = await resolveForumChannel()
    expect(resolved.forumName).toBe('robot-city-dev')
    expect(resolved.forumId).toBe('dev-forum')
  })

  test('creates forum if missing', async () => {
    process.env.DISCORD_GUILD_ID = 'g'
    process.env.DISCORD_FORUM_NAME = 'robot-city-pr-7'
    mockFetch((req) => req.url.endsWith('/guilds/g/channels') && req.method === 'GET', {
      json: [{ id: 'other', name: 'general', type: 0 }],
    })
    mockFetch((req) => req.url.endsWith('/guilds/g/channels') && req.method === 'POST', {
      json: { id: 'new-forum' },
    })

    const resolved = await resolveForumChannel()
    expect(resolved.forumId).toBe('new-forum')

    const createCall = fetchCalls().find(c => c.method === 'POST')!
    expect((createCall.bodyJson() as { name: string }).name).toBe('robot-city-pr-7')
  })

  test('getResolvedForumId throws before resolution', () => {
    expect(() => getResolvedForumId()).toThrow(/not resolved/)
  })

  test('getResolvedForumId returns cached id after resolution', async () => {
    process.env.DISCORD_GUILD_ID = 'g'
    mockFetch(/\/guilds\/g\/channels$/, {
      json: [{ id: 'cached-id', name: 'robot-city', type: 15 }],
    })
    await resolveForumChannel()
    expect(getResolvedForumId()).toBe('cached-id')
  })
})
