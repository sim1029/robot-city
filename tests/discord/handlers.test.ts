import { describe, expect, test, beforeAll, beforeEach, afterEach, afterAll } from 'bun:test'
import { installFetchMock, uninstallFetchMock, resetFetchMock, mockFetch, fetchCalls } from '../_helpers/fetch-mock'
import { db } from '../../src/db/client'
import { migrate } from '../../src/db/schema'
import {
  handleApprovalInteraction,
  handleThreadMessage,
  sendApprovalCardForApproval,
} from '../../src/discord/handlers'
import {
  createApproval,
  registerApprovalHandler,
  getApproval,
  resetApprovalHandlersForTest,
} from '../../src/approvals/state'

describe('discord handlers', () => {
  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    process.env.DISCORD_BOT_TOKEN = 'bot-token'
    migrate()
    installFetchMock()
  })
  beforeEach(() => {
    db.run('DELETE FROM pending_approvals')
    db.run('DELETE FROM events')
    db.run('DELETE FROM sessions')
    resetApprovalHandlersForTest()
  })
  afterEach(() => resetFetchMock())
  afterAll(() => uninstallFetchMock())

  test('sendApprovalCardForApproval DMs the card and persists discord_message_id', async () => {
    const id = createApproval({ action: 'send_email', payload: { to: 'a@b.com', subject: 'hi', body: 'x' } })
    mockFetch('https://discord.com/api/v10/users/@me/channels', { json: { id: 'dm-1' } })
    mockFetch('https://discord.com/api/v10/channels/dm-1/messages', { json: { id: 'msg-9' } })

    await sendApprovalCardForApproval(id, 'discord-user-1')
    const a = getApproval(id)
    expect(a?.discord_message_id).toBe('msg-9')
    const calls = fetchCalls()
    const sendCall = calls.find(c => c.url.endsWith('/messages'))!
    const body = sendCall.bodyJson() as { components: unknown[] }
    expect(body.components).toHaveLength(1)
  })

  test('handleApprovalInteraction approve → calls handler, edits card to resolved', async () => {
    let handlerCalled = false
    registerApprovalHandler('send_email', async () => {
      handlerCalled = true
      return { id: 'gmail-1', threadId: 'gth-1' }
    })
    const id = createApproval({ action: 'send_email', payload: { to: 'a@b.com', subject: 'hi', body: 'x' } })
    db.run('UPDATE pending_approvals SET discord_message_id = ? WHERE id = ?', ['msg-9', id])

    mockFetch(/channels\/.*\/messages\/msg-9$/, { json: { id: 'msg-9' } })

    const result = await handleApprovalInteraction({
      customId: `approval:${id}:approve`,
      interactionChannelId: 'dm-1',
    })

    expect(result.kind).toBe('resolved')
    if (result.kind === 'resolved') expect(result.decision).toBe('approve')
    expect(handlerCalled).toBe(true)
    expect(getApproval(id)?.status).toBe('approved')

    const editCall = fetchCalls().find(c => c.method === 'PATCH')
    expect(editCall).toBeDefined()
    const body = editCall!.bodyJson() as { content: string; components: unknown[] }
    expect(body.content).toContain('Sent')
    expect(body.components).toEqual([])
  })

  test('handleApprovalInteraction reject → marks rejected, edits card', async () => {
    registerApprovalHandler('send_email', async () => ({}))
    const id = createApproval({ action: 'send_email', payload: { to: 'a@b.com', subject: 'hi', body: 'x' } })
    db.run('UPDATE pending_approvals SET discord_message_id = ? WHERE id = ?', ['msg-9', id])

    mockFetch(/channels\/.*\/messages\/msg-9$/, { json: { id: 'msg-9' } })

    const result = await handleApprovalInteraction({
      customId: `approval:${id}:reject`,
      interactionChannelId: 'dm-1',
    })
    expect(result.kind).toBe('resolved')
    if (result.kind === 'resolved') expect(result.decision).toBe('reject')
    expect(getApproval(id)?.status).toBe('rejected')
  })

  test('handleApprovalInteraction with malformed customId returns ignored', async () => {
    const r = await handleApprovalInteraction({ customId: 'unrelated:foo', interactionChannelId: 'dm-1' })
    expect(r.kind).toBe('ignored')
  })

  test('handleApprovalInteraction returns stale on already-resolved approval', async () => {
    registerApprovalHandler('send_email', async () => ({}))
    const id = createApproval({ action: 'send_email', payload: { to: 'a@b.com', subject: 'hi', body: 'x' } })
    db.run("UPDATE pending_approvals SET status = 'approved', discord_message_id = ? WHERE id = ?", ['msg-9', id])

    const result = await handleApprovalInteraction({
      customId: `approval:${id}:approve`,
      interactionChannelId: 'dm-1',
    })
    expect(result.kind).toBe('stale')
  })

  test('handleThreadMessage runs pipeline and replies in thread with footer', async () => {
    // classify
    mockFetch('https://api.anthropic.com/v1/messages', {
      json: {
        model: 'claude-haiku-4-5-20251001',
        content: [{ text: 'CONVERSATION\nGeneral chat.' }],
        usage: { input_tokens: 50, output_tokens: 10 },
      },
    }, { once: true })
    // reason
    mockFetch('https://api.anthropic.com/v1/messages', {
      json: {
        model: 'claude-sonnet-4-6',
        content: [{ text: 'Here is the answer.' }],
        usage: { input_tokens: 80, output_tokens: 20 },
      },
    }, { once: true })
    // act
    mockFetch('https://api.anthropic.com/v1/messages', {
      json: {
        model: 'claude-haiku-4-5-20251001',
        content: [{ text: '{"tool":"none"}' }],
        usage: { input_tokens: 60, output_tokens: 5 },
      },
    }, { once: true })
    // thread history fetch (no prior history for this turn)
    mockFetch(/channels\/thread-1\/messages\?/, { json: [] })
    // typing indicator (fire-and-forget, may or may not arrive before messages)
    mockFetch(/channels\/thread-1\/typing$/, { status: 204, json: null })
    mockFetch(/channels\/thread-1\/messages$/, { json: { id: 'reply-1' } })

    await handleThreadMessage({
      threadId: 'thread-1',
      userId: 'discord-user-1',
      messageId: 'msg-current',
      content: 'What time is it?',
    })

    const replyCall = fetchCalls().find(c => c.method === 'POST' && c.url.endsWith('/thread-1/messages'))!
    const body = replyCall.bodyJson() as { content: string }
    expect(body.content).toContain('Here is the answer.')
    expect(body.content).toContain('─────────────────────────────────')
    expect(body.content).toMatch(/\$\d+\.\d{4}/)
  })

  test('handleThreadMessage footer includes "session $X.XXXX" totals', async () => {
    mockFetch('https://api.anthropic.com/v1/messages', {
      json: { model: 'claude-haiku-4-5-20251001', content: [{ text: 'CONVERSATION\nchat' }], usage: { input_tokens: 50, output_tokens: 10 } },
    }, { once: true })
    mockFetch('https://api.anthropic.com/v1/messages', {
      json: { model: 'claude-sonnet-4-6', content: [{ text: 'Answer.' }], usage: { input_tokens: 80, output_tokens: 20 } },
    }, { once: true })
    mockFetch('https://api.anthropic.com/v1/messages', {
      json: { model: 'claude-haiku-4-5-20251001', content: [{ text: '{"tool":"none"}' }], usage: { input_tokens: 60, output_tokens: 5 } },
    }, { once: true })
    mockFetch(/channels\/thread-2\/messages\?/, { json: [] })
    mockFetch(/channels\/thread-2\/typing$/, { status: 204, json: null })
    mockFetch(/channels\/thread-2\/messages$/, { json: { id: 'reply-2' } })

    await handleThreadMessage({
      threadId: 'thread-2',
      userId: 'discord-user-1',
      messageId: 'msg-c2',
      content: 'hi',
    })

    const replyCall = fetchCalls().find(c => c.method === 'POST' && c.url.endsWith('/thread-2/messages'))!
    const body = replyCall.bodyJson() as { content: string }
    expect(body.content).toMatch(/session \$\d+\.\d{4}/)
  })

  test('handleThreadMessage sends full thread history to the reason stage', async () => {
    // classify (consumes one anthropic call)
    mockFetch('https://api.anthropic.com/v1/messages', {
      json: { model: 'claude-haiku-4-5-20251001', content: [{ text: 'CONVERSATION\nchat' }], usage: { input_tokens: 50, output_tokens: 10 } },
    }, { once: true })

    // capture the reason stage request body to assert on it
    let reasonBody: { system?: string; messages: Array<{ role: string; content: string }> } | null = null
    mockFetch((req) => {
      if (req.url !== 'https://api.anthropic.com/v1/messages') return false
      const parsed = req.bodyJson() as { model: string }
      return parsed.model === 'claude-sonnet-4-6'
    }, async (req) => {
      reasonBody = req.bodyJson() as { system?: string; messages: Array<{ role: string; content: string }> }
      return {
        json: { model: 'claude-sonnet-4-6', content: [{ text: 'Got it.' }], usage: { input_tokens: 200, output_tokens: 30 } },
      }
    }, { once: true })

    // act
    mockFetch('https://api.anthropic.com/v1/messages', {
      json: { model: 'claude-haiku-4-5-20251001', content: [{ text: '{"tool":"none"}' }], usage: { input_tokens: 60, output_tokens: 5 } },
    }, { once: true })

    // Thread history: two prior user msgs + one assistant reply (with footer to be stripped)
    mockFetch(/channels\/thread-9\/messages\?/, {
      json: [
        // Discord returns newest-first
        {
          id: 'h3', timestamp: '2026-05-10T12:02:00.000Z', content: 'Sure, here is the plan.\n\n─────────────────────────────────\n↑ 1 in  ↓ 2 out  ⏱ 0.1s\n$0.0001 (claude-sonnet-4-6)  •  session $0.0001',
          author: { id: 'bot-1', username: 'robot-city', bot: true },
        },
        {
          id: 'h2', timestamp: '2026-05-10T12:01:00.000Z', content: 'What about Tuesday?',
          author: { id: 'user-1', username: 'me', bot: false },
        },
        {
          id: 'h1', timestamp: '2026-05-10T12:00:00.000Z', content: 'Schedule a meeting.',
          author: { id: 'user-1', username: 'me', bot: false },
        },
      ],
    })
    mockFetch(/channels\/thread-9\/typing$/, { status: 204, json: null })
    mockFetch(/channels\/thread-9\/messages$/, { json: { id: 'reply-9' } })

    await handleThreadMessage({
      threadId: 'thread-9',
      userId: 'discord-user-1',
      messageId: 'msg-current',
      content: 'Make it Wednesday.',
    })

    expect(reasonBody).not.toBeNull()
    const messages = reasonBody!.messages
    // Expect alternating history followed by the latest user turn
    expect(messages.length).toBeGreaterThanOrEqual(4)
    // Earliest is user
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toContain('Schedule a meeting.')
    // Middle has the previous user msg + assistant reply (footer stripped)
    expect(messages.some(m => m.role === 'user' && m.content.includes('What about Tuesday?'))).toBe(true)
    const assistantMsg = messages.find(m => m.role === 'assistant')
    expect(assistantMsg).toBeDefined()
    expect(assistantMsg!.content).toContain('Sure, here is the plan.')
    expect(assistantMsg!.content).not.toContain('session $')
    expect(assistantMsg!.content).not.toContain('─')
    // Last user message in the conversation is the new prompt
    const lastUser = [...messages].reverse().find(m => m.role === 'user')!
    expect(lastUser.content).toContain('Make it Wednesday.')

    // Discord fetch should have used `before` so the current message is not in history
    const historyCall = fetchCalls().find(c => c.method === 'GET' && c.url.includes('/channels/thread-9/messages'))!
    expect(historyCall.url).toContain('before=msg-current')
  })
})
