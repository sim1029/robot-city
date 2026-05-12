import type { ToolCall, ToolDefinition } from '../providers/types'

export type StageName = 'classify' | 'gather' | 'reason'

export interface StageConfig {
  model: string
  maxOutputTokens: number
  systemPrompt?: string
  tools?: ToolDefinition[]
}

export interface StageResult {
  stage: StageName
  text: string
  inputTokens: number
  outputTokens: number
  model: string
  costUsd: number
  latencyMs: number
  toolCalls?: ToolCall[]
}

export interface RunResult {
  stages: StageResult[]
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  totalLatencyMs: number
  footer: string
}
