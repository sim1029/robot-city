import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { migrate } from '../db/schema'
import { runCalendarSuite } from '../evals/runner'
import type { AssistantConfiguration, CalendarScenario } from '../evals/types'

const root = process.cwd()
const args = parseArgs(process.argv.slice(2))
const configId = args.config ?? 'baseline'
const config = loadJson<AssistantConfiguration>(join(root, 'benchmarks/configurations', `${configId}.json`))
const configuration: AssistantConfiguration = {
  ...config,
  classifyModel: args['classify-model'] ?? config.classifyModel,
  reasonModel: args['reason-model'] ?? config.reasonModel,
}
const allScenarios = loadScenarios()
const scenarios = allScenarios.filter(scenario =>
  (!args.scenario || scenario.id === args.scenario) && (!args.tag || scenario.tags.includes(args.tag))
)

if (scenarios.length === 0) throw new Error('No benchmark scenarios matched the supplied filters.')
migrate()
const result = await runCalendarSuite({
  scenarios,
  configuration,
  trialsPerScenario: Number(args.trials ?? 3),
})
const dir = join(root, 'data/evaluations')
mkdirSync(dir, { recursive: true })
const filename = `${result.createdAt.replace(/[:.]/g, '-')}-${configuration.id}.json`
const output = join(dir, filename)
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`)

console.table({
  configuration: configuration.id,
  intent: percent(result.summary.intent),
  action: percent(result.summary.action),
  outcome: percent(result.summary.outcome),
  reply: percent(result.summary.reply),
  passRate: percent(result.summary.passRate),
  averageCost: `$${result.summary.averageCostUsd.toFixed(4)}`,
  totalCost: `$${result.summary.totalCostUsd.toFixed(4)}`,
})
console.log(`Saved benchmark evidence to ${output}`)
if (!result.complete) console.log('This filtered or nonstandard run is diagnostic only and cannot be published.')

function loadScenarios(): CalendarScenario[] {
  const dir = join(root, 'benchmarks/calendar-v1')
  return readdirSync(dir)
    .filter(file => file.endsWith('.json'))
    .sort()
    .map(file => loadJson<CalendarScenario>(join(dir, file)))
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as T
}

function parseArgs(parts: string[]): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part.startsWith('--')) continue
    const [key, value] = part.slice(2).split('=', 2)
    parsed[key] = value ?? parts[++i] ?? ''
  }
  return parsed
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}
