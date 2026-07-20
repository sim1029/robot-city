import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { installFetchMock, mockFetch, resetFetchMock, uninstallFetchMock } from '../_helpers/fetch-mock'
import { runCalendarScenario, scoreScenario } from '../../src/evals/runner'
import type { AssistantConfiguration, CalendarScenario } from '../../src/evals/types'

const configuration: AssistantConfiguration = {
  id: 'test',
  label: 'Test configuration',
  classifyModel: 'claude-haiku-4-5-20251001',
  reasonModel: 'claude-sonnet-4-6',
}

const scenario: CalendarScenario = {
  id: 'create-lunch',
  title: 'Create lunch',
  tags: ['calendar'],
  turns: ['Create lunch with Maya tomorrow at noon for 30 minutes.'],
  world: {
    now: '2026-07-19T09:00:00-04:00',
    timezone: 'America/New_York',
    calendars: [{ id: 'primary', summary: 'Personal', primary: true, accessRole: 'owner', timeZone: 'America/New_York' }],
    events: [],
  },
  expect: {
    intent: ['CREATE_CALENDAR_EVENT'],
    tool: 'create_calendar_event',
    created: [{ title: 'Lunch with Maya', start: '2026-07-20T12:00:00-04:00', end: '2026-07-20T12:30:00-04:00' }],
    reply: { mustContain: ['lunch'] },
  },
}

describe('calendar evaluation runner', () => {
  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    process.env.DISCORD_BOT_TOKEN = 'test-bot'
    installFetchMock()
  })
  afterEach(() => resetFetchMock())
  afterAll(() => uninstallFetchMock())

  test('runs the production tool loop against the fake calendar and scores it', async () => {
    mockFetch('https://api.anthropic.com/v1/messages', {
      json: anthropic('claude-haiku-4-5-20251001', [{ type: 'text', text: 'CREATE_CALENDAR_EVENT\nThe user wants a calendar event.' }]),
    }, { once: true })
    mockFetch('https://api.anthropic.com/v1/messages', {
      json: anthropic('claude-sonnet-4-6', [{ type: 'tool_use', id: 'tool-1', name: 'create_calendar_event', input: { title: 'Lunch with Maya', start: '2026-07-20T12:00:00', end: '2026-07-20T12:30:00' } }]),
    }, { once: true })
    mockFetch('https://api.anthropic.com/v1/messages', {
      json: anthropic('claude-sonnet-4-6', [{ type: 'text', text: 'Created Lunch with Maya.' }]),
    }, { once: true })

    const result = await runCalendarScenario(scenario, configuration, 1)

    expect(result.score).toEqual({ intent: true, action: true, outcome: true, reply: true, passed: true })
    expect(result.createdEvents).toHaveLength(1)
    expect(result.calendarRequests.some(request => request.method === 'POST')).toBe(true)
  })

  test('scores a no-action scenario without treating calendar reads as a mutation', () => {
    const trace = {
      scenarioId: 'none', trial: 1, classifyOutput: 'CONVERSATION\nChat.', reply: 'Here are some ideas.',
      calendarRequests: [{ method: 'GET', path: '/calendar/v3/calendars/primary/events' }],
      createdEvents: [], totalCostUsd: 0, totalLatencyMs: 0,
    }
    const noAction: CalendarScenario = { ...scenario, expect: { intent: ['CONVERSATION'], tool: 'none', created: [] } }
    expect(scoreScenario(noAction, trace)).toEqual({ intent: true, action: true, outcome: true, reply: true, passed: true })
  })
})

function anthropic(model: string, content: unknown[]) {
  return { model, content, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } }
}
