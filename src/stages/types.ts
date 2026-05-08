export type StageName = 'classify' | 'gather' | 'reason' | 'act'

export interface StageConfig {
  model: string
  maxOutputTokens: number
  systemPrompt?: string
}

export interface StageResult {
  stage: StageName
  text: string
  inputTokens: number
  outputTokens: number
  model: string
  costUsd: number
  latencyMs: number
}

export interface RunResult {
  stages: StageResult[]
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  totalLatencyMs: number
  footer: string
}
