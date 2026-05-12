import { describe, expect, test, beforeAll, beforeEach, afterEach, afterAll } from 'bun:test'
import { installFetchMock, uninstallFetchMock, resetFetchMock, mockFetch } from '../_helpers/fetch-mock'
import { db } from '../../src/db/client'
import { migrate } from '../../src/db/schema'
import { runStage, buildFooter } from '../../src/stages/runner'
import { getSessionCost } from '../../src/db/sessions'
import type { StageResult } from '../../src/stages/types'

// Haiku pricing: $0.80 in / $4.00 out per 1M tokens
// 100 input + 50 output = (100*0.80 + 50*4.00)/1e6 = 0.00028
const EXPECTED_COST_PER_CALL = 0.00028

function mockAnthropicHaiku(text = 'ok', once = true) {
  mockFetch('https://api.anthropic.com/v1/messages', {
    json: {
      model: 'claude-haiku-4-5-20251001',
      content: [{ text }],
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  }, { once })
}

describe('session cost accumulation', () => {
  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    migrate()
    installFetchMock()
  })
  beforeEach(() => {
    db.run('DELETE FROM events')
    db.run('DELETE FROM sessions')
  })
  afterEach(() => resetFetchMock())
  afterAll(() => uninstallFetchMock())

  test('runStage increments sessions.total_cost_usd by the stage cost', async () => {
    mockAnthropicHaiku()
    await runStage('classify', 'hello', 'sess-A')

    const row = db.query('SELECT total_cost_usd FROM sessions WHERE id = ?').get('sess-A') as { total_cost_usd: number } | null
    expect(row).not.toBeNull()
    expect(row!.total_cost_usd).toBeCloseTo(EXPECTED_COST_PER_CALL, 8)
  })

  test('repeated runStage calls in same session accumulate cost', async () => {
    mockAnthropicHaiku('a', false)
    await runStage('classify', 'first', 'sess-B')
    await runStage('gather', 'second', 'sess-B')
    await runStage('act', 'third', 'sess-B')

    const total = getSessionCost('sess-B')
    expect(total).toBeCloseTo(EXPECTED_COST_PER_CALL * 3, 8)
  })

  test('getSessionCost returns 0 for unknown session', () => {
    expect(getSessionCost('does-not-exist')).toBe(0)
  })

  test('runStage with sessionId "discord:<threadId>" stores the threadId on the row', async () => {
    mockAnthropicHaiku()
    await runStage('classify', 'hi', 'discord:thread-xyz')

    const row = db.query('SELECT discord_thread_id FROM sessions WHERE id = ?').get('discord:thread-xyz') as { discord_thread_id: string | null } | null
    expect(row?.discord_thread_id).toBe('thread-xyz')
  })

  test('runStage with non-discord sessionId leaves discord_thread_id null', async () => {
    mockAnthropicHaiku()
    await runStage('classify', 'hi', 'sess-C')

    const row = db.query('SELECT discord_thread_id FROM sessions WHERE id = ?').get('sess-C') as { discord_thread_id: string | null } | null
    expect(row?.discord_thread_id).toBeNull()
  })

  test('buildFooter with sessionCostUsd includes "session $X"', () => {
    const stage: StageResult = {
      stage: 'reason',
      text: 'r',
      inputTokens: 100, outputTokens: 50,
      model: 'claude-sonnet-4-6',
      costUsd: 0.0041, latencyMs: 1200,
    }
    const footer = buildFooter([stage], 0.0182)
    expect(footer).toContain('session $0.0182')
    expect(footer).toContain('$0.0041')
    expect(footer).toContain('claude-sonnet-4-6')
  })

  test('buildFooter shows highest-tier model across stages, not last stage model', () => {
    const haiku: StageResult = { stage: 'classify', text: '', inputTokens: 10, outputTokens: 5, model: 'claude-haiku-4-5-20251001', costUsd: 0.0001, latencyMs: 100 }
    const sonnet: StageResult = { stage: 'reason', text: '', inputTokens: 500, outputTokens: 200, model: 'claude-sonnet-4-6', costUsd: 0.004, latencyMs: 1000 }
    const haikuAct: StageResult = { stage: 'act', text: '', inputTokens: 10, outputTokens: 5, model: 'claude-haiku-4-5-20251001', costUsd: 0.0001, latencyMs: 100 }
    const footer = buildFooter([haiku, sonnet, haikuAct], 0.02)
    expect(footer).toContain('claude-sonnet-4-6')
    expect(footer).not.toContain('haiku')
  })

  test('buildFooter without sessionCostUsd omits the session segment', () => {
    const stage: StageResult = {
      stage: 'reason',
      text: 'r',
      inputTokens: 100, outputTokens: 50,
      model: 'claude-sonnet-4-6',
      costUsd: 0.0041, latencyMs: 1200,
    }
    const footer = buildFooter([stage])
    expect(footer).not.toContain('session $')
  })
})
