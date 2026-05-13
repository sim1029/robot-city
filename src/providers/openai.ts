import type { LLMRequest, LLMResponse } from './types'

export async function callOpenAI(req: LLMRequest, apiKey: string): Promise<LLMResponse> {
  const start = Date.now()
  const toStr = (c: typeof req.messages[0]['content']): string =>
    typeof c === 'string' ? c : c.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('\n')

  const messages: Array<{ role: string; content: string }> = [
    ...(req.system ? [{ role: 'system', content: req.system }] : []),
    ...req.messages.map(m => ({ role: m.role, content: toStr(m.content) })),
  ]

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: req.model,
      messages,
      max_tokens: req.maxTokens,
      temperature: req.temperature ?? 0.3,
    }),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)
  const data = await res.json() as OpenAIResponse
  return {
    text: data.choices[0].message.content,
    inputTokens: data.usage.prompt_tokens,
    outputTokens: data.usage.completion_tokens,
    model: data.model,
    latencyMs: Date.now() - start,
  }
}

interface OpenAIResponse {
  model: string
  choices: Array<{ message: { content: string } }>
  usage: { prompt_tokens: number; completion_tokens: number }
}
