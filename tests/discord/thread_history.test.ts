import { describe, expect, test, beforeAll, beforeEach, afterEach, afterAll } from 'bun:test'
import { installFetchMock, uninstallFetchMock, resetFetchMock, mockFetch, fetchCalls } from '../_helpers/fetch-mock'
import { fetchThreadHistory } from '../../src/discord/history'
import { db } from '../../src/db/client'
import { migrate } from '../../src/db/schema'

const BOT_USER_ID = 'bot-1'

function discordMessage(opts: { id: string; content: string; bot?: boolean; timestamp?: string }) {
  return {
    id: opts.id,
    content: opts.content,
    author: { id: opts.bot ? BOT_USER_ID : 'user-1', username: opts.bot ? 'robot-city' : 'user', bot: !!opts.bot },
    timestamp: opts.timestamp ?? '2026-05-10T12:00:00.000Z',
  }
}

describe('fetchThreadHistory', () => {
  beforeAll(() => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token'
    migrate()
    installFetchMock()
  })
  beforeEach(() => {
    db.run('DELETE FROM events')
    db.run('DELETE FROM sessions')
  })
  afterEach(() => resetFetchMock())
  afterAll(() => uninstallFetchMock())

  test('hits Discord channels/:id/messages with limit, returns chronological order', async () => {
    // Discord returns newest-first
    mockFetch(/channels\/thread-1\/messages\?limit=\d+$/, {
      json: [
        discordMessage({ id: 'm3', content: 'third', timestamp: '2026-05-10T12:02:00.000Z' }),
        discordMessage({ id: 'm2', content: 'second', bot: true, timestamp: '2026-05-10T12:01:00.000Z' }),
        discordMessage({ id: 'm1', content: 'first', timestamp: '2026-05-10T12:00:00.000Z' }),
      ],
    })

    const history = await fetchThreadHistory('thread-1')

    const call = fetchCalls().find(c => c.url.includes('/channels/thread-1/messages'))!
    expect(call.url).toMatch(/limit=\d+/)
    expect(call.method).toBe('GET')
    expect(call.headers.authorization).toBe('Bot bot-token')

    // Chronological order, oldest first
    expect(history.map(m => m.content)).toEqual(['first', 'second', 'third'])
  })

  test('assigns role:assistant for bot messages, role:user for human messages', async () => {
    mockFetch(/channels\/thread-1\/messages/, {
      json: [
        discordMessage({ id: 'm2', content: 'bot reply', bot: true, timestamp: '2026-05-10T12:01:00.000Z' }),
        discordMessage({ id: 'm1', content: 'user msg', timestamp: '2026-05-10T12:00:00.000Z' }),
      ],
    })

    const history = await fetchThreadHistory('thread-1')
    expect(history).toEqual([
      { role: 'user', content: 'user msg' },
      { role: 'assistant', content: 'bot reply' },
    ])
  })

  test('strips footer (separator + below) from assistant messages', async () => {
    const botContent = [
      'Here is the answer.',
      '',
      '─────────────────────────────────',
      '↑ 100 in  ↓ 50 out  ⏱ 1.0s',
      '$0.0003 (claude-haiku-4-5-20251001)  •  session $0.0010',
    ].join('\n')

    mockFetch(/channels\/thread-1\/messages/, {
      json: [discordMessage({ id: 'm1', content: botContent, bot: true })],
    })

    const history = await fetchThreadHistory('thread-1')
    expect(history).toHaveLength(1)
    expect(history[0].role).toBe('assistant')
    expect(history[0].content).toBe('Here is the answer.')
    expect(history[0].content).not.toContain('─')
    expect(history[0].content).not.toContain('session $')
  })

  test('excludes message matching beforeMessageId via Discord before= param', async () => {
    mockFetch(/channels\/thread-1\/messages\?.*before=m-current/, {
      json: [
        discordMessage({ id: 'm1', content: 'older', timestamp: '2026-05-10T12:00:00.000Z' }),
      ],
    })

    const history = await fetchThreadHistory('thread-1', 'm-current')
    const call = fetchCalls().find(c => c.url.includes('/channels/thread-1/messages'))!
    expect(call.url).toContain('before=m-current')
    expect(history.map(m => m.content)).toEqual(['older'])
  })

  test('empty thread returns empty array', async () => {
    mockFetch(/channels\/thread-1\/messages/, { json: [] })
    const history = await fetchThreadHistory('thread-1')
    expect(history).toEqual([])
  })

  test('restores hidden audio transcripts for prior user messages', async () => {
    db.run(
      `INSERT INTO sessions (id, discord_thread_id, created_at, total_cost_usd)
       VALUES ('discord:thread-audio-history', 'thread-audio-history', 1, 0)`
    )
    db.run(
      `INSERT INTO events (session_id, type, model, payload, output)
       VALUES (?, 'audio:transcription', 'gpt-4o-mini-transcribe', ?, ?)`,
      [
        'discord:thread-audio-history',
        JSON.stringify({ threadId: 'thread-audio-history', messageId: 'voice-1', attachmentId: 'att-1' }),
        'Please move lunch to Friday.',
      ]
    )

    mockFetch(/channels\/thread-audio-history\/messages/, {
      json: [
        discordMessage({ id: 'voice-1', content: '', timestamp: '2026-05-10T12:00:00.000Z' }),
      ],
    })

    const history = await fetchThreadHistory('thread-audio-history')
    expect(history).toEqual([{ role: 'user', content: 'Please move lunch to Friday.' }])
  })

  test('merges hidden audio transcripts with visible text in history', async () => {
    db.run(
      `INSERT INTO sessions (id, discord_thread_id, created_at, total_cost_usd)
       VALUES ('discord:thread-mixed-history', 'thread-mixed-history', 1, 0)`
    )
    db.run(
      `INSERT INTO events (session_id, type, model, payload, output)
       VALUES (?, 'audio:transcription', 'gpt-4o-mini-transcribe', ?, ?)`,
      [
        'discord:thread-mixed-history',
        JSON.stringify({ threadId: 'thread-mixed-history', messageId: 'mixed-1', attachmentId: 'att-1' }),
        'and invite Sarah.',
      ]
    )

    mockFetch(/channels\/thread-mixed-history\/messages/, {
      json: [
        discordMessage({ id: 'mixed-1', content: 'Set up planning', timestamp: '2026-05-10T12:00:00.000Z' }),
      ],
    })

    const history = await fetchThreadHistory('thread-mixed-history')
    expect(history).toEqual([{
      role: 'user',
      content: 'Set up planning\n\n[TRANSCRIBED AUDIO]\nand invite Sarah.',
    }])
  })
})
