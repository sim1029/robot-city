import type { LLMRequest, LLMResponse } from './types'

export async function callAnthropic(req: LLMRequest, apiKey: string): Promise<LLMResponse> {
  const start = Date.now()
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages,
      temperature: req.temperature ?? 0.3,
    }),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
  const data = await res.json() as AnthropicResponse
  return {
    text: data.content[0].text,
    inputTokens: data.usage.input_tokens,
    outputTokens: data.usage.output_tokens,
    model: data.model,
    latencyMs: Date.now() - start,
  }
}

interface AnthropicResponse {
  model: string
  content: Array<{ text: string }>
  usage: { input_tokens: number; output_tokens: number }
}
