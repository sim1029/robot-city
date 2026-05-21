import { describe, expect, test, beforeAll, beforeEach, afterEach, afterAll } from 'bun:test'
import { installFetchMock, uninstallFetchMock, resetFetchMock, mockFetch, fetchCalls } from '../_helpers/fetch-mock'
import { db } from '../../src/db/client'
import { migrate } from '../../src/db/schema'
import {
  handleApprovalInteraction,
  handleEditModalSubmit,
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
    process.env.OPENAI_API_KEY = 'sk-openai-test'
    process.env.DISCORD_BOT_TOKEN = 'bot-token'
    migrate()
    installFetchMock()
  })
  beforeEach(() => {
    db.run('DELETE FROM pending_approvals')
    db.run('DELETE FROM events')
    db.run('DELETE FROM sessions')
    db.run('DELETE FROM gmail_tokens')
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

  test('handleApprovalInteraction edit → returns show_modal with correct modal structure', async () => {
    const id = createApproval({ action: 'send_email', payload: { to: 'a@b.com', subject: 'hi', body: 'draft body' } })

    const result = await handleApprovalInteraction({
      customId: `approval:${id}:edit`,
      interactionChannelId: 'dm-1',
    })

    expect(result.kind).toBe('show_modal')
    if (result.kind !== 'show_modal') return
    expect(result.modal.custom_id).toBe(`approval:${id}:edit_submit`)
    expect(result.modal.title).toBe('Edit Email')
    const subjectInput = result.modal.components[0].components[0]
    expect(subjectInput.value).toBe('hi')
    const bodyInput = result.modal.components[1].components[0]
    expect(bodyInput.value).toBe('draft body')
    // approval stays pending — no state change
    expect(getApproval(id)?.status).toBe('pending')
  })

  test('handleEditModalSubmit updates payload and refreshes card', async () => {
    const id = createApproval({ action: 'send_email', payload: { to: 'a@b.com', subject: 'old subject', body: 'old body' } })
    db.run('UPDATE pending_approvals SET discord_message_id = ? WHERE id = ?', ['msg-edit', id])

    mockFetch(/channels\/.*\/messages\/msg-edit$/, { json: { id: 'msg-edit' } })

    const result = await handleEditModalSubmit({
      customId: `approval:${id}:edit_submit`,
      fields: { subject: 'new subject', body: 'new body' },
      interactionChannelId: 'dm-edit',
    })

    expect(result.kind).toBe('edited')
    const updated = getApproval(id)!
    const payload = updated.payload as { subject: string; body: string }
    expect(payload.subject).toBe('new subject')
    expect(payload.body).toBe('new body')
    expect(updated.status).toBe('pending')

    const editCall = fetchCalls().find(c => c.method === 'PATCH')!
    const body = editCall.bodyJson() as { content: string; components: unknown[] }
    expect(body.content).toContain('new subject')
    expect(body.content).toContain('new body')
    expect(body.components).toHaveLength(1) // still has buttons
  })

  test('handleEditModalSubmit with malformed customId returns ignored', async () => {
    const r = await handleEditModalSubmit({
      customId: 'other:foo:bar',
      fields: { subject: 's', body: 'b' },
      interactionChannelId: 'dm-1',
    })
    expect(r.kind).toBe('ignored')
  })

  test('handleEditModalSubmit returns stale on already-resolved approval', async () => {
    const id = createApproval({ action: 'send_email', payload: { to: 'a@b.com', subject: 'hi', body: 'x' } })
    db.run("UPDATE pending_approvals SET status = 'approved' WHERE id = ?", [id])

    const result = await handleEditModalSubmit({
      customId: `approval:${id}:edit_submit`,
      fields: { subject: 's', body: 'b' },
      interactionChannelId: 'dm-1',
    })
    expect(result.kind).toBe('stale')
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
        content: [{ type: 'text', text: 'CONVERSATION\nGeneral chat.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, output_tokens: 10 },
      },
    }, { once: true })
    // reason — no tool_use blocks → loop exits after one iteration
    mockFetch('https://api.anthropic.com/v1/messages', {
      json: {
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'Here is the answer.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 80, output_tokens: 20 },
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
      json: { model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text: 'CONVERSATION\nchat' }], stop_reason: 'end_turn', usage: { input_tokens: 50, output_tokens: 10 } },
    }, { once: true })
    mockFetch('https://api.anthropic.com/v1/messages', {
      json: { model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'Answer.' }], stop_reason: 'end_turn', usage: { input_tokens: 80, output_tokens: 20 } },
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
    let reasonBody: { system?: string; messages: Array<{ role: string; content: unknown }> } | null = null
    mockFetch((req) => {
      if (req.url !== 'https://api.anthropic.com/v1/messages') return false
      const parsed = req.bodyJson() as { model: string }
      return parsed.model === 'claude-sonnet-4-6'
    }, async (req) => {
      reasonBody = req.bodyJson() as { system?: string; messages: Array<{ role: string; content: unknown }> }
      return {
        json: { model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'Got it.' }], stop_reason: 'end_turn', usage: { input_tokens: 200, output_tokens: 30 } },
      }
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
    const strContent = (m: { content: unknown }) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    // Expect alternating history followed by the latest user turn
    expect(messages.length).toBeGreaterThanOrEqual(4)
    // Earliest is user
    expect(messages[0].role).toBe('user')
    expect(strContent(messages[0])).toContain('Schedule a meeting.')
    // Middle has the previous user msg + assistant reply (footer stripped)
    expect(messages.some(m => m.role === 'user' && strContent(m).includes('What about Tuesday?'))).toBe(true)
    const assistantMsg = messages.find(m => m.role === 'assistant')
    expect(assistantMsg).toBeDefined()
    expect(strContent(assistantMsg!)).toContain('Sure, here is the plan.')
    expect(strContent(assistantMsg!)).not.toContain('session $')
    expect(strContent(assistantMsg!)).not.toContain('─')
    // Last user message in the conversation is the new prompt
    const lastUser = [...messages].reverse().find(m => m.role === 'user')!
    expect(strContent(lastUser)).toContain('Make it Wednesday.')

    // Discord fetch should have used `before` so the current message is not in history
    const historyCall = fetchCalls().find(c => c.method === 'GET' && c.url.includes('/channels/thread-9/messages'))!
    expect(historyCall.url).toContain('before=msg-current')
  })

  test('handleThreadMessage transcribes audio-only messages before running the pipeline', async () => {
    mockFetch(/channels\/thread-audio\/typing$/, { status: 204, json: null })
    mockFetch('https://cdn.discordapp.com/audio-note.m4a', {
      text: 'fake audio bytes',
      headers: { 'content-type': 'audio/mp4' },
    })
    mockFetch('https://api.openai.com/v1/audio/transcriptions', {
      json: { text: 'Schedule lunch tomorrow at noon.' },
    })
    mockFetch(/channels\/thread-audio\/messages\?/, { json: [] })

    let classifyBody: { messages: Array<{ content: string }> } | null = null
    mockFetch('https://api.anthropic.com/v1/messages', async (req) => {
      classifyBody = req.bodyJson() as { messages: Array<{ content: string }> }
      return {
        json: {
          model: 'claude-haiku-4-5-20251001',
          content: [{ type: 'text', text: 'CREATE_CALENDAR_EVENT\nUser wants lunch scheduled.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 50, output_tokens: 10 },
        },
      }
    }, { once: true })

    mockFetch('https://api.anthropic.com/v1/messages', {
      json: {
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'I can help with that.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 80, output_tokens: 20 },
      },
    }, { once: true })
    mockFetch(/channels\/thread-audio\/messages$/, { json: { id: 'reply-audio' } })

    await handleThreadMessage({
      threadId: 'thread-audio',
      userId: 'discord-user-1',
      messageId: 'msg-audio',
      content: '',
      attachments: [{
        id: 'att-audio',
        name: 'audio-note.m4a',
        contentType: 'audio/mp4',
        size: 1024,
        url: 'https://cdn.discordapp.com/audio-note.m4a',
        duration: null,
        waveform: null,
      }],
    })

    const capturedClassifyBody = classifyBody as { messages: Array<{ content: string }> } | null
    expect(capturedClassifyBody?.messages[0].content).toContain('Schedule lunch tomorrow at noon.')
    const transcriptionEvent = db.query(
      "SELECT output FROM events WHERE type = 'audio:transcription' AND session_id = 'discord:thread-audio'"
    ).get() as { output: string } | null
    expect(transcriptionEvent?.output).toBe('Schedule lunch tomorrow at noon.')

    const openAiCall = fetchCalls().find(c => c.url === 'https://api.openai.com/v1/audio/transcriptions')!
    expect(openAiCall.headers.authorization).toBe('Bearer sk-openai-test')
  })

  test('handleThreadMessage combines typed text and transcribed audio', async () => {
    mockFetch(/channels\/thread-mixed\/typing$/, { status: 204, json: null })
    mockFetch('https://cdn.discordapp.com/context.wav', {
      text: 'fake wav bytes',
      headers: { 'content-type': 'audio/wav' },
    })
    mockFetch('https://api.openai.com/v1/audio/transcriptions', {
      json: { text: 'and make it for the product team.' },
    })
    mockFetch(/channels\/thread-mixed\/messages\?/, { json: [] })
    mockFetch('https://api.anthropic.com/v1/messages', {
      json: {
        model: 'claude-haiku-4-5-20251001',
        content: [{ type: 'text', text: 'CONVERSATION\nCombined request.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, output_tokens: 10 },
      },
    }, { once: true })

    let reasonMessages: Array<{ role: string; content: unknown }> | null = null
    mockFetch('https://api.anthropic.com/v1/messages', async (req) => {
      reasonMessages = (req.bodyJson() as { messages: Array<{ role: string; content: unknown }> }).messages
      return {
        json: {
          model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: 'Done.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 80, output_tokens: 20 },
        },
      }
    }, { once: true })
    mockFetch(/channels\/thread-mixed\/messages$/, { json: { id: 'reply-mixed' } })

    await handleThreadMessage({
      threadId: 'thread-mixed',
      userId: 'discord-user-1',
      messageId: 'msg-mixed',
      content: 'Schedule a sync',
      attachments: [{
        id: 'att-mixed',
        name: 'context.wav',
        contentType: 'audio/wav',
        size: 2048,
        url: 'https://cdn.discordapp.com/context.wav',
        duration: null,
        waveform: null,
      }],
    })

    const lastUser = [...reasonMessages!].reverse().find(m => m.role === 'user')!
    expect(String(lastUser.content)).toContain('Schedule a sync')
    expect(String(lastUser.content)).toContain('[TRANSCRIBED AUDIO]')
    expect(String(lastUser.content)).toContain('and make it for the product team.')
  })

  test('handleThreadMessage rejects multiple audio attachments before LLM calls', async () => {
    mockFetch(/channels\/thread-many-audio\/typing$/, { status: 204, json: null })
    mockFetch(/channels\/thread-many-audio\/messages$/, { json: { id: 'reply-many-audio' } })

    await handleThreadMessage({
      threadId: 'thread-many-audio',
      userId: 'discord-user-1',
      messageId: 'msg-many-audio',
      content: '',
      attachments: [
        { id: 'a1', name: 'one.m4a', contentType: 'audio/mp4', size: 100, url: 'https://cdn.discordapp.com/one.m4a', duration: null, waveform: null },
        { id: 'a2', name: 'two.wav', contentType: 'audio/wav', size: 100, url: 'https://cdn.discordapp.com/two.wav', duration: null, waveform: null },
      ],
    })

    const replyCall = fetchCalls().find(c => c.method === 'POST' && c.url.endsWith('/thread-many-audio/messages'))!
    expect((replyCall.bodyJson() as { content: string }).content).toContain('only one audio file')
    expect(fetchCalls().some(c => c.url === 'https://api.anthropic.com/v1/messages')).toBe(false)
    expect(fetchCalls().some(c => c.url === 'https://api.openai.com/v1/audio/transcriptions')).toBe(false)
  })

  test('handleThreadMessage executes tool natively and feeds tool_result into second reason iteration', async () => {
    // Provide a gmail_tokens row so gmailUserId is set and FORUM_TOOLS are passed to reason
    db.run(
      `INSERT INTO gmail_tokens (user_id, access_token, refresh_token, expires_at, scope) VALUES ('u1', 'tok', 'ref', 9999999999, 'email')`
    )

    // classify
    mockFetch('https://api.anthropic.com/v1/messages', {
      json: { model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text: 'READ_EMAIL\nUser wants email summary.' }], stop_reason: 'end_turn', usage: { input_tokens: 50, output_tokens: 10 } },
    }, { once: true })

    // first reason — returns tool_use block requesting read_email
    mockFetch('https://api.anthropic.com/v1/messages', {
      json: {
        model: 'claude-sonnet-4-6',
        content: [
          { type: 'text', text: 'Let me check your emails.' },
          { type: 'tool_use', id: 'tu_001', name: 'read_email', input: {} },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 80, output_tokens: 25 },
      },
    }, { once: true })

    // second reason — receives tool_result, returns final response with no tool calls
    let secondReasonMessages: Array<{ role: string; content: unknown }> | null = null
    mockFetch(
      (req) => {
        if (req.url !== 'https://api.anthropic.com/v1/messages') return false
        return (req.bodyJson() as { model: string }).model === 'claude-sonnet-4-6'
      },
      async (req) => {
        secondReasonMessages = (req.bodyJson() as { messages: Array<{ role: string; content: unknown }> }).messages
        return { json: { model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'You have no recent emails.' }], stop_reason: 'end_turn', usage: { input_tokens: 200, output_tokens: 30 } } }
      },
      { once: true }
    )

    mockFetch(/channels\/thread-loop\/messages\?/, { json: [] })
    mockFetch(/channels\/thread-loop\/typing$/, { status: 204, json: null })
    mockFetch(/channels\/thread-loop\/messages$/, { json: { id: 'reply-loop' } })

    await handleThreadMessage({
      threadId: 'thread-loop',
      userId: 'discord-user-1',
      messageId: 'msg-loop',
      content: 'Show me my recent emails.',
    })

    expect(secondReasonMessages).not.toBeNull()

    // The assistant's first turn should be an array with text + tool_use blocks
    const assistantTurn = secondReasonMessages!.find(m => m.role === 'assistant' && Array.isArray(m.content))
    expect(assistantTurn).toBeDefined()
    const assistantBlocks = assistantTurn!.content as Array<{ type: string; name?: string }>
    expect(assistantBlocks.some(b => b.type === 'tool_use' && b.name === 'read_email')).toBe(true)

    // The tool_result user message should contain the read_email output
    const toolResultTurn = secondReasonMessages!.find(m =>
      m.role === 'user' && Array.isArray(m.content) &&
      (m.content as Array<{ type: string }>).some(b => b.type === 'tool_result')
    )
    expect(toolResultTurn).toBeDefined()
    const resultBlocks = toolResultTurn!.content as Array<{ type: string; content?: string }>
    expect(resultBlocks.find(b => b.type === 'tool_result')?.content).toContain('No emails triaged')

    // Final reply should use the SECOND reason text only
    const replyCall = fetchCalls().find(c => c.method === 'POST' && c.url.endsWith('/thread-loop/messages'))!
    const body = replyCall.bodyJson() as { content: string }
    expect(body.content).toContain('You have no recent emails.')
    expect(body.content).not.toContain('Let me check your emails.')
  })
})
