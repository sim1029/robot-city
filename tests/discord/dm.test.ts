import { describe, expect, test, beforeAll, afterEach, afterAll } from 'bun:test'
import { installFetchMock, uninstallFetchMock, resetFetchMock, mockFetch, fetchCalls } from '../_helpers/fetch-mock'
import { sendDm, editChannelMessage, sendThreadMessage } from '../../src/discord/dm'

describe('discord REST helpers', () => {
  beforeAll(() => {
    installFetchMock()
    process.env.DISCORD_BOT_TOKEN = 'bot-token'
  })
  afterEach(() => resetFetchMock())
  afterAll(() => uninstallFetchMock())

  test('sendDm opens channel and posts message', async () => {
    mockFetch('https://discord.com/api/v10/users/@me/channels', { json: { id: 'dm-channel-1' } })
    mockFetch('https://discord.com/api/v10/channels/dm-channel-1/messages', { json: { id: 'msg-1' } })

    const result = await sendDm('user-1', { content: 'hi', components: [] })
    expect(result.channelId).toBe('dm-channel-1')
    expect(result.messageId).toBe('msg-1')

    const calls = fetchCalls()
    expect(calls).toHaveLength(2)
    expect(calls[0].headers['authorization']).toBe('Bot bot-token')
    expect((calls[0].bodyJson() as { recipient_id: string }).recipient_id).toBe('user-1')
  })

  test('editChannelMessage PATCHes the message', async () => {
    mockFetch('https://discord.com/api/v10/channels/c1/messages/m1', { json: { id: 'm1' } })
    await editChannelMessage('c1', 'm1', { content: 'updated', components: [] })

    const call = fetchCalls()[0]
    expect(call.method).toBe('PATCH')
    expect((call.bodyJson() as { content: string }).content).toBe('updated')
  })

  test('sendThreadMessage posts to thread channel', async () => {
    mockFetch('https://discord.com/api/v10/channels/thread-1/messages', { json: { id: 'm-1' } })
    const id = await sendThreadMessage('thread-1', 'reply text')
    expect(id).toBe('m-1')
    const call = fetchCalls()[0]
    expect((call.bodyJson() as { content: string }).content).toBe('reply text')
  })
})
