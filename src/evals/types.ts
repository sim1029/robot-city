import type { CalendarEvent, CalendarListEntry } from '../calendar/client'

export interface AssistantConfiguration {
  id: string
  label: string
  classifyModel: string
  reasonModel: string
}

export interface CalendarWorldFixture {
  now: string
  timezone: string
  calendars: CalendarListEntry[]
  events: CalendarEvent[]
}

export interface CalendarScenarioExpectation {
  intent: string[]
  tool: 'read_calendar' | 'create_calendar_event' | 'none'
  created?: Array<{
    title: string
    start?: string
    end?: string
    location?: string
    calendarId?: string
  }>
  reply?: {
    mustContain?: string[]
    mustNotContain?: string[]
  }
}

export interface CalendarScenario {
  id: string
  title: string
  tags: string[]
  turns: string[]
  world: CalendarWorldFixture
  expect: CalendarScenarioExpectation
}

export interface CalendarRequestTrace {
  method: string
  path: string
  body?: Record<string, unknown>
}

export interface TrialScore {
  intent: boolean
  action: boolean
  outcome: boolean
  reply: boolean
  passed: boolean
}

export interface ScenarioTrialResult {
  scenarioId: string
  trial: number
  score: TrialScore
  classifyOutput: string
  reply: string
  calendarRequests: CalendarRequestTrace[]
  createdEvents: CalendarEvent[]
  totalCostUsd: number
  totalLatencyMs: number
  error?: string
}

export interface EvaluationResult {
  formatVersion: 1
  suiteId: string
  suiteVersion: string
  complete: boolean
  configuration: AssistantConfiguration
  promptFingerprint: string
  gitCommit: string
  createdAt: string
  trialsPerScenario: number
  scenarioIds: string[]
  trials: ScenarioTrialResult[]
  summary: {
    intent: number
    action: number
    outcome: number
    reply: number
    passRate: number
    averageCostUsd: number
    averageLatencyMs: number
    totalCostUsd: number
  }
}
