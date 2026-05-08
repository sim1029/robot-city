import { callAnthropic } from './anthropic'
import { callOpenAI } from './openai'
import { callGoogle } from './google'
import type { LLMRequest, LLMResponse } from './types'
import { getKey } from '../vault'
import pricing from '../../pricing.json'

type PricingMap = Record<string, { input: number; output: number }>
const PRICING = pricing as PricingMap

export async function callLLM(req: LLMRequest): Promise<LLMResponse & { costUsd: number }> {
  let response: LLMResponse

  if (req.model.startsWith('claude-')) {
    const key = await getKey('anthropic')
    response = await callAnthropic(req, key)
  } else if (
    req.model.startsWith('gpt-') ||
    req.model.startsWith('o1') ||
    req.model.startsWith('o3')
  ) {
    const key = await getKey('openai')
    response = await callOpenAI(req, key)
  } else if (req.model.startsWith('gemini-')) {
    const key = await getKey('google')
    response = await callGoogle(req, key)
  } else {
    throw new Error(`Unknown model "${req.model}". Expected claude-*, gpt-*, o1*, o3*, or gemini-*.`)
  }

  const costUsd = computeCost(response.model, response.inputTokens, response.outputTokens)
  return { ...response, costUsd }
}

function computeCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model]
  if (!p) return 0
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000
}
