import type { LLMRequest, LLMResponse } from './types'

export async function callGoogle(req: LLMRequest, apiKey: string): Promise<LLMResponse> {
  const start = Date.now()

  type GContent = { role: string; parts: Array<{ text: string }> }
  const toStr = (c: typeof req.messages[0]['content']): string =>
    typeof c === 'string' ? c : c.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('\n')
  const contents: GContent[] = req.messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: toStr(m.content) }],
  }))

  // Inject system prompt as a priming exchange since not all Gemini models
  // support the systemInstruction field in the same way
  if (req.system) {
    contents.unshift({ role: 'user', parts: [{ text: req.system }] })
    contents.splice(1, 0, { role: 'model', parts: [{ text: 'Understood.' }] })
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          maxOutputTokens: req.maxTokens,
          temperature: req.temperature ?? 0.3,
        },
      }),
    }
  )
  if (!res.ok) throw new Error(`Google ${res.status}: ${await res.text()}`)
  const data = await res.json() as GoogleResponse
  return {
    text: data.candidates[0].content.parts[0].text,
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    model: req.model,
    latencyMs: Date.now() - start,
  }
}

interface GoogleResponse {
  candidates: Array<{ content: { parts: Array<{ text: string }> } }>
  usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number }
}
