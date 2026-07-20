import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { EvaluationResult } from '../evals/types'

const resultPath = process.argv[2]
if (!resultPath) throw new Error('Usage: npm run eval:publish -- data/evaluations/<result>.json')
const result = JSON.parse(readFileSync(resultPath, 'utf8')) as EvaluationResult
if (!result.complete || result.suiteId !== 'calendar-v1' || result.trialsPerScenario !== 3 || result.scenarioIds.length !== 10) {
  throw new Error('Only a complete calendar-v1 run with three trials across all ten scenarios can be published.')
}

const root = process.cwd()
const publishedDir = join(root, 'benchmarks/published-results', result.configuration.id)
mkdirSync(publishedDir, { recursive: true })
writeFileSync(join(publishedDir, basename(resultPath)), `${JSON.stringify(result, null, 2)}\n`)

const entries = loadPublishedResults(join(root, 'benchmarks/published-results'))
entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
const rows = entries.map(entry => [
  entry.configuration.label,
  entry.configuration.classifyModel,
  entry.configuration.reasonModel,
  `${percent(entry.summary.passRate)} (${percent(entry.summary.intent)} intent / ${percent(entry.summary.action)} action / ${percent(entry.summary.outcome)} outcome / ${percent(entry.summary.reply)} reply)`,
  `$${entry.summary.averageCostUsd.toFixed(4)}`,
  entry.createdAt.slice(0, 10),
]).map(row => `| ${row.join(' | ')} |`).join('\n')

writeFileSync(join(root, 'docs/benchmarks.md'), `# Assistant benchmarks\n\nThese are intentionally published snapshots from the live-model calendar-v1 suite. Each result runs the same ten scenarios three times against a fake Calendar and Discord environment; no Google or Discord data is changed.\n\n| Configuration | Classifier | Reason/tool model | Scorecard | Average cost/turn | Published |\n|---|---|---|---|---:|---|\n${rows}\n\nEach entry records its suite version, prompt fingerprint, commit, per-trial trace, and costs under \`benchmarks/published-results/\`.\n`)
console.log(`Published ${result.configuration.id} and regenerated docs/benchmarks.md`)

function loadPublishedResults(dir: string): EvaluationResult[] {
  const results: EvaluationResult[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) results.push(...loadPublishedResults(path))
    if (entry.isFile() && entry.name.endsWith('.json')) results.push(JSON.parse(readFileSync(path, 'utf8')) as EvaluationResult)
  }
  return results
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}
