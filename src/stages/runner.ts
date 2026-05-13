import { callLLM } from '../providers/router'
import type { ContentBlock } from '../providers/types'
import type { StageName, StageConfig, StageResult, RunResult } from './types'
import { insertEvent } from '../db/events'
import { bumpSessionCost, ensureSession } from '../db/sessions'

const STAGE_DEFAULTS: Record<StageName, StageConfig> = {
  classify: {
    model: 'claude-haiku-4-5-20251001',
    maxOutputTokens: 200,
    systemPrompt: 'You are a concise classifier. Output only the classification label and a one-sentence reason. Be brief.',
  },
  gather: {
    model: 'claude-haiku-4-5-20251001',
    maxOutputTokens: 500,
    systemPrompt: 'Summarize the retrieved data concisely. Extract only what is relevant to the user request.',
  },
  reason: {
    model: 'claude-sonnet-4-6',
    maxOutputTokens: 2000,
    systemPrompt: "You are an AI life concierge. Use the available tools to help the user — read_calendar and read_email return results immediately; invite_attendees and send_email require user approval. Never say you can't access external services. Ignore internal pipeline tags [ORIGINAL MESSAGE], [CLASSIFY], [CONTEXT] — they are metadata, not conversation.",
  },
}

export type StageInput = string | Array<{ role: 'user' | 'assistant'; content: string | ContentBlock[] }>

export async function runStage(
  stage: StageName,
  input: StageInput,
  sessionId: string | null,
  overrides: Partial<StageConfig> = {}
): Promise<StageResult> {
  const config: StageConfig = { ...STAGE_DEFAULTS[stage], ...overrides }
  const messages = typeof input === 'string' ? [{ role: 'user' as const, content: input }] : input

  const result = await callLLM({
    model: config.model,
    system: config.systemPrompt,
    messages,
    maxTokens: config.maxOutputTokens,
    tools: config.tools,
  })

  const stageResult: StageResult = {
    stage,
    text: result.text,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    model: result.model,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
    toolCalls: result.toolCalls,
  }

  if (sessionId) {
    ensureSession(sessionId)
    bumpSessionCost(sessionId, result.costUsd)
  }

  const lastContent = messages.at(-1)?.content
  const promptPreview = typeof input === 'string'
    ? input.slice(0, 300)
    : typeof lastContent === 'string' ? lastContent.slice(0, 300) : JSON.stringify(lastContent).slice(0, 300)

  insertEvent({
    sessionId,
    type: `stage:${stage}`,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
    payload: JSON.stringify({ prompt: promptPreview }),
    output: result.text,
  })

  return stageResult
}

const MODEL_TIERS = ['haiku', 'sonnet', 'opus']

function highestTierModel(models: string[]): string {
  return models.reduce((best, m) => {
    const mTier = MODEL_TIERS.findIndex(t => m.toLowerCase().includes(t))
    const bestTier = MODEL_TIERS.findIndex(t => best.toLowerCase().includes(t))
    return mTier > bestTier ? m : best
  }, models[0] ?? 'unknown')
}

export function buildFooter(stages: StageResult[], sessionCostUsd?: number): string {
  const totalIn = stages.reduce((s, r) => s + r.inputTokens, 0)
  const totalOut = stages.reduce((s, r) => s + r.outputTokens, 0)
  const totalMs = stages.reduce((s, r) => s + r.latencyMs, 0)
  const totalCost = stages.reduce((s, r) => s + r.costUsd, 0)
  const primaryModel = highestTierModel(stages.map(s => s.model))

  const lines = [
    '─────────────────────────────────',
    `↑ ${totalIn.toLocaleString()} in  ↓ ${totalOut.toLocaleString()} out  ⏱ ${(totalMs / 1000).toFixed(1)}s`,
    `$${totalCost.toFixed(4)} (${primaryModel})${sessionCostUsd !== undefined ? `  •  session $${sessionCostUsd.toFixed(4)}` : ''}`,
  ]
  return lines.join('\n')
}

export async function runPipeline(
  prompt: string,
  sessionId: string | null,
  stages: StageName[] = ['classify', 'reason']
): Promise<RunResult> {
  const results: StageResult[] = []
  let context = prompt

  for (const stage of stages) {
    const result = await runStage(stage, context, sessionId)
    results.push(result)
    context = `${prompt}\n\n[${stage.toUpperCase()} OUTPUT]\n${result.text}`
  }

  const totalInputTokens = results.reduce((s, r) => s + r.inputTokens, 0)
  const totalOutputTokens = results.reduce((s, r) => s + r.outputTokens, 0)
  const totalCostUsd = results.reduce((s, r) => s + r.costUsd, 0)
  const totalLatencyMs = results.reduce((s, r) => s + r.latencyMs, 0)

  return {
    stages: results,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
    totalLatencyMs,
    footer: buildFooter(results),
  }
}
