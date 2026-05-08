export interface LLMRequest {
  model: string
  system?: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  maxTokens: number
  temperature?: number
}

export interface LLMResponse {
  text: string
  inputTokens: number
  outputTokens: number
  model: string
  latencyMs: number
}
