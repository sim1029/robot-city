import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { migrate } from '../db/schema'
import { sqlite } from '../db/client'
import { saveGmailTokens } from '../gmail/tokens'
import { setSetting } from '../db/settings'
import { handleThreadMessage } from '../discord/handlers'
import { CalendarWorld } from './calendar_world'
import { DiscordWorld } from './discord_world'
import type {
  AssistantConfiguration,
  CalendarScenario,
  EvaluationResult,
  ScenarioTrialResult,
  TrialScore,
} from './types'

const PROVIDER_HOSTS = new Set([
  'api.anthropic.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
])
const FOOTER_SEPARATOR = '─────────────────────────────────'

export async function runCalendarScenario(
  scenario: CalendarScenario,
  configuration: AssistantConfiguration,
  trial: number
): Promise<ScenarioTrialResult> {
  migrate()
  clearEvaluationState()
  setSetting('timezone', scenario.world.timezone)
  saveGmailTokens({
    user_id: 'eval@example.com',
    access_token: 'eval-access-token',
    refresh_token: 'eval-refresh-token',
    expires_at: Date.now() + 60 * 60 * 1000,
    scope: 'calendar.events',
  })

  const calendar = new CalendarWorld(scenario.world)
  const discord = new DiscordWorld()
  const now = new Date(scenario.world.now)
  const restoreFetch = installEvaluationNetwork(calendar, discord)
  const sessionId = `discord:eval-${scenario.id}-${trial}`

  try {
    process.env.DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || 'eval-bot-token'
    for (const content of scenario.turns) {
      const messageId = `incoming-${crypto.randomUUID()}`
      await handleThreadMessage({
        threadId: sessionId.replace('discord:', ''),
        userId: 'eval-user',
        messageId,
        content,
        now,
        stageModels: { classify: configuration.classifyModel, reason: configuration.reasonModel },
      })
      discord.addUserMessage(content)
    }

    const trace = collectTrace(sessionId, scenario, trial, calendar, discord.lastReply())
    return { ...trace, score: scoreScenario(scenario, trace) }
  } catch (error) {
    const trace = collectTrace(sessionId, scenario, trial, calendar, discord.lastReply())
    return {
      ...trace,
      error: error instanceof Error ? error.message : String(error),
      score: { intent: false, action: false, outcome: false, reply: false, passed: false },
    }
  } finally {
    restoreFetch()
  }
}

export async function runCalendarSuite(args: {
  scenarios: CalendarScenario[]
  configuration: AssistantConfiguration
  trialsPerScenario?: number
}): Promise<EvaluationResult> {
  const trialsPerScenario = args.trialsPerScenario ?? 3
  const trials: ScenarioTrialResult[] = []
  for (const scenario of args.scenarios) {
    for (let trial = 1; trial <= trialsPerScenario; trial++) {
      trials.push(await runCalendarScenario(scenario, args.configuration, trial))
    }
  }

  const count = trials.length || 1
  const totalTurns = args.scenarios.reduce((sum, scenario) => sum + scenario.turns.length, 0) * trialsPerScenario || 1
  const fraction = (key: keyof TrialScore) => trials.filter(trial => trial.score[key]).length / count
  const totalCostUsd = trials.reduce((sum, trial) => sum + trial.totalCostUsd, 0)
  const totalLatencyMs = trials.reduce((sum, trial) => sum + trial.totalLatencyMs, 0)
  return {
    formatVersion: 1,
    suiteId: 'calendar-v1',
    suiteVersion: '1',
    complete: args.scenarios.length === 10 && trialsPerScenario === 3,
    configuration: args.configuration,
    promptFingerprint: promptFingerprint(),
    gitCommit: gitCommit(),
    createdAt: new Date().toISOString(),
    trialsPerScenario,
    scenarioIds: args.scenarios.map(scenario => scenario.id),
    trials,
    summary: {
      intent: fraction('intent'),
      action: fraction('action'),
      outcome: fraction('outcome'),
      reply: fraction('reply'),
      passRate: fraction('passed'),
      averageCostUsd: totalCostUsd / totalTurns,
      averageLatencyMs: totalLatencyMs / totalTurns,
      totalCostUsd,
    },
  }
}

export function scoreScenario(scenario: CalendarScenario, trace: Omit<ScenarioTrialResult, 'score'>): TrialScore {
  const label = trace.classifyOutput.split('\n')[0]?.trim().toUpperCase() ?? ''
  const intent = scenario.expect.intent.some(expected => label === expected.toUpperCase())
  const created = trace.createdEvents
  const action = scenario.expect.tool === 'none'
    ? trace.calendarRequests.every(request => request.method !== 'POST')
    : scenario.expect.tool === 'read_calendar'
      ? trace.calendarRequests.some(request => request.method === 'GET' && /\/events$/.test(request.path))
      : trace.calendarRequests.some(request => request.method === 'POST' && /\/events$/.test(request.path))
  const outcome = expectedOutcome(scenario, created)
  const reply = expectedReply(scenario, trace.reply)
  return { intent, action, outcome, reply, passed: intent && action && outcome && reply }
}

function expectedOutcome(scenario: CalendarScenario, created: ScenarioTrialResult['createdEvents']): boolean {
  const expected = scenario.expect.created ?? []
  if (created.length !== expected.length) return false
  return expected.every((wanted, index) => {
    const actual = created[index] as typeof created[number] & { calendarId?: string }
    if (!actual || actual.summary.toLowerCase() !== wanted.title.toLowerCase()) return false
    if (wanted.start && actual.start.dateTime !== wanted.start) return false
    if (wanted.end && actual.end.dateTime !== wanted.end) return false
    if (wanted.location && actual.location !== wanted.location) return false
    return !wanted.calendarId || actual.calendarId === wanted.calendarId
  })
}

function expectedReply(scenario: CalendarScenario, reply: string): boolean {
  const visible = reply.split(FOOTER_SEPARATOR)[0].toLowerCase()
  const rules = scenario.expect.reply
  if (!rules) return true
  return (rules.mustContain ?? []).every(value => visible.includes(value.toLowerCase()))
    && (rules.mustNotContain ?? []).every(value => !visible.includes(value.toLowerCase()))
}

function collectTrace(
  sessionId: string,
  scenario: CalendarScenario,
  trial: number,
  calendar: CalendarWorld,
  reply: string
): Omit<ScenarioTrialResult, 'score'> {
  const classifyOutput = sqlite.query("SELECT output FROM events WHERE session_id = ? AND type = 'stage:classify' ORDER BY id DESC LIMIT 1")
    .get(sessionId) as { output?: string } | null
  const costs = sqlite.query('SELECT COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(SUM(latency_ms), 0) AS latency FROM events WHERE session_id = ?')
    .get(sessionId) as { cost: number; latency: number }
  return {
    scenarioId: scenario.id,
    trial,
    classifyOutput: classifyOutput?.output ?? '',
    reply,
    calendarRequests: calendar.requests,
    createdEvents: calendar.createdEvents(),
    totalCostUsd: costs.cost,
    totalLatencyMs: costs.latency,
  }
}

function clearEvaluationState(): void {
  sqlite.run('DELETE FROM pending_approvals')
  sqlite.run('DELETE FROM events')
  sqlite.run('DELETE FROM sessions')
  sqlite.run('DELETE FROM gmail_tokens')
}

function installEvaluationNetwork(calendar: CalendarWorld, discord: DiscordWorld): () => void {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const requestInput = input instanceof URL ? input.toString() : input
    const request = requestInput instanceof Request
      ? new Request(requestInput, init)
      : new Request(requestInput, init)
    const url = new URL(request.url)
    if (url.hostname === 'www.googleapis.com' && url.pathname.startsWith('/calendar/v3/')) return calendar.handle(request)
    if (url.hostname === 'discord.com' && url.pathname.startsWith('/api/v10/')) return discord.handle(request)
    if (PROVIDER_HOSTS.has(url.hostname)) {
      return requestInput instanceof Request
        ? originalFetch(requestInput, init)
        : originalFetch(requestInput, init)
    }
    return new Response(JSON.stringify({ error: `benchmark blocked network request to ${url.hostname}` }), { status: 599 })
  }) as typeof fetch
  return () => { globalThis.fetch = originalFetch }
}

function promptFingerprint(): string {
  const root = process.cwd()
  const content = [
    readFileSync(resolve(root, 'src/stages/runner.ts')),
    readFileSync(resolve(root, 'src/discord/handlers.ts')),
  ].join('\n')
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}
