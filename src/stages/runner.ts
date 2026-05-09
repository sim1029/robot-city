import { callLLM } from '../providers/router'
import type { StageName, StageConfig, StageResult, RunResult } from './types'
import { db } from '../db/client'

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
    systemPrompt: 'You are a helpful AI life concierge. Think carefully and provide a clear, actionable response.',
  },
  act: {
    model: 'claude-haiku-4-5-20251001',
    maxOutputTokens: 300,
    systemPrompt: 'Output a single JSON object describing the action to take. No prose.',
  },
}

export async function runStage(
  stage: StageName,
  prompt: string,
  sessionId: string | null,
  overrides: Partial<StageConfig> = {}
): Promise<StageResult> {
  const config: StageConfig = { ...STAGE_DEFAULTS[stage], ...overrides }

  const result = await callLLM({
    model: config.model,
    system: config.systemPrompt,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: config.maxOutputTokens,
  })

  const stageResult: StageResult = {
    stage,
    text: result.text,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    model: result.model,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
  }

  if (sessionId) {
    db.run(
      `INSERT OR IGNORE INTO sessions (id, created_at, total_cost_usd) VALUES (?, ?, 0)`,
      [sessionId, Date.now()]
    )
  }

  db.run(
    `INSERT INTO events (session_id, type, model, input_tokens, output_tokens, cost_usd, latency_ms, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      `stage:${stage}`,
      result.model,
      result.inputTokens,
      result.outputTokens,
      result.costUsd,
      result.latencyMs,
      JSON.stringify({ prompt: prompt.slice(0, 300) }),
    ]
  )

  return stageResult
}

export function buildFooter(stages: StageResult[], sessionCostUsd?: number): string {
  const totalIn = stages.reduce((s, r) => s + r.inputTokens, 0)
  const totalOut = stages.reduce((s, r) => s + r.outputTokens, 0)
  const totalMs = stages.reduce((s, r) => s + r.latencyMs, 0)
  const totalCost = stages.reduce((s, r) => s + r.costUsd, 0)
  const primaryModel = stages.at(-1)?.model ?? 'unknown'

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
    // Each stage's output becomes input context for the next
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
