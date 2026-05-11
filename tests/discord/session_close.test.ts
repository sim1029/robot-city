import { describe, expect, test, beforeAll, beforeEach, afterEach, afterAll } from 'bun:test'
import { installFetchMock, uninstallFetchMock, resetFetchMock, mockFetch, fetchCalls } from '../_helpers/fetch-mock'
import { db } from '../../src/db/client'
import { migrate } from '../../src/db/schema'
import { handleThreadArchive } from '../../src/discord/handlers'

function insertEvent(opts: {
  session_id: string
  type: string
  input_tokens?: number
  output_tokens?: number
  cost_usd?: number
  latency_ms?: number
}) {
  db.run(
    `INSERT INTO events (session_id, type, model, input_tokens, output_tokens, cost_usd, latency_ms, payload, output)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.session_id,
      opts.type,
      'claude-haiku-4-5-20251001',
      opts.input_tokens ?? 0,
      opts.output_tokens ?? 0,
      opts.cost_usd ?? 0,
      opts.latency_ms ?? 0,
      '{}',
      'output',
    ]
  )
}

describe('handleThreadArchive — session close + summary', () => {
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

  test('computes summary stats from events and posts summary to thread', async () => {
    const sessionId = 'discord:thread-1'
    db.run(
      `INSERT INTO sessions (id, discord_thread_id, created_at, total_cost_usd) VALUES (?, ?, ?, ?)`,
      [sessionId, 'thread-1', 1_700_000_000, 0.0210]
    )
    // 2 user turns: each contributes classify + reason + act events
    insertEvent({ session_id: sessionId, type: 'stage:classify', input_tokens: 50, output_tokens: 10, cost_usd: 0.0001 })
    insertEvent({ session_id: sessionId, type: 'stage:reason', input_tokens: 200, output_tokens: 80, cost_usd: 0.0018 })
    insertEvent({ session_id: sessionId, type: 'stage:act', input_tokens: 60, output_tokens: 5, cost_usd: 0.0001 })
    insertEvent({ session_id: sessionId, type: 'stage:classify', input_tokens: 50, output_tokens: 10, cost_usd: 0.0001 })
    insertEvent({ session_id: sessionId, type: 'stage:reason', input_tokens: 220, output_tokens: 90, cost_usd: 0.0020 })
    insertEvent({ session_id: sessionId, type: 'stage:act', input_tokens: 65, output_tokens: 5, cost_usd: 0.0001 })
    // One tool call
    insertEvent({ session_id: sessionId, type: 'tool:send_email' })

    mockFetch(/channels\/thread-1\/messages$/, { json: { id: 'summary-msg-1' } })

    await handleThreadArchive({ threadId: 'thread-1' })

    const postCall = fetchCalls().find(c => c.method === 'POST' && c.url.endsWith('/channels/thread-1/messages'))
    expect(postCall).toBeDefined()
    const body = postCall!.bodyJson() as { content: string }
    // Stats it must surface
    expect(body.content).toMatch(/session/i)
    expect(body.content).toContain('$0.0210')           // total cost from sessions row (or summed)
    expect(body.content).toMatch(/2 messages?/)          // # user turns (stage:reason count)
    expect(body.content).toMatch(/1 tool/)               // # tool:* events
    expect(body.content).toMatch(/645 in/)               // sum input_tokens across stages
    expect(body.content).toMatch(/200 out/)              // sum output_tokens
    // No LLM-generated recap (stats only)
    expect(body.content).not.toMatch(/claude-/)
  })

  test('sets sessions.closed_at on close', async () => {
    const sessionId = 'discord:thread-2'
    db.run(
      `INSERT INTO sessions (id, discord_thread_id, created_at, total_cost_usd) VALUES (?, ?, ?, ?)`,
      [sessionId, 'thread-2', 1_700_000_000, 0]
    )
    mockFetch(/channels\/thread-2\/messages$/, { json: { id: 's-msg' } })

    await handleThreadArchive({ threadId: 'thread-2' })

    const row = db.query('SELECT closed_at FROM sessions WHERE id = ?').get(sessionId) as { closed_at: number | null }
    expect(row.closed_at).not.toBeNull()
    expect(row.closed_at!).toBeGreaterThan(0)
  })

  test('idempotent — second archive does not post a second summary', async () => {
    const sessionId = 'discord:thread-3'
    db.run(
      `INSERT INTO sessions (id, discord_thread_id, created_at, closed_at, total_cost_usd) VALUES (?, ?, ?, ?, ?)`,
      [sessionId, 'thread-3', 1_700_000_000, 1_700_001_000, 0.005]
    )

    // No fetch stub set — if handler tries to post, fetch-mock will throw.
    await handleThreadArchive({ threadId: 'thread-3' })

    const posts = fetchCalls().filter(c => c.method === 'POST' && c.url.endsWith('/channels/thread-3/messages'))
    expect(posts).toHaveLength(0)
  })

  test('no-op if no session row exists for thread', async () => {
    // No insert, no mock — should not blow up and should not post
    await handleThreadArchive({ threadId: 'unknown-thread' })
    const posts = fetchCalls().filter(c => c.url.includes('/channels/unknown-thread/messages'))
    expect(posts).toHaveLength(0)
  })
})
