import type { LLMRequest, LLMResponse, ToolCall } from './types'

export async function callAnthropic(req: LLMRequest, apiKey: string): Promise<LLMResponse> {
  const start = Date.now()
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: req.messages,
    temperature: req.temperature ?? 0.3,
  }
  if (req.tools?.length) body.tools = req.tools

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
  const data = await res.json() as AnthropicResponse

  const textBlocks = data.content.filter((b): b is AnthropicTextBlock => b.type === 'text')
  const toolUseBlocks = data.content.filter((b): b is AnthropicToolUseBlock => b.type === 'tool_use')

  const toolCalls: ToolCall[] | undefined = toolUseBlocks.length
    ? toolUseBlocks.map(b => ({ id: b.id, name: b.name, input: b.input }))
    : undefined

  return {
    text: textBlocks.map(b => b.text).join('\n').trim(),
    inputTokens: data.usage.input_tokens,
    outputTokens: data.usage.output_tokens,
    model: data.model,
    latencyMs: Date.now() - start,
    toolCalls,
  }
}

type AnthropicTextBlock = { type: 'text'; text: string }
type AnthropicToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

interface AnthropicResponse {
  model: string
  content: Array<AnthropicTextBlock | AnthropicToolUseBlock>
  stop_reason: string
  usage: { input_tokens: number; output_tokens: number }
}
