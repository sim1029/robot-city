export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

export interface ToolDefinition {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface LLMRequest {
  model: string
  system?: string
  messages: Array<{ role: 'user' | 'assistant'; content: string | ContentBlock[] }>
  maxTokens: number
  temperature?: number
  tools?: ToolDefinition[]
}

export interface LLMResponse {
  text: string
  inputTokens: number
  outputTokens: number
  model: string
  latencyMs: number
  toolCalls?: ToolCall[]
}
