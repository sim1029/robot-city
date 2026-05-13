import { db } from './client'

const LLM_EVENT_LIMIT = 100

export function insertEvent(params: {
  sessionId: string | null
  type: string
  model?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  costUsd?: number | null
  latencyMs?: number | null
  payload?: string | null
  output?: string | null
}): void {
  db.run(
    `INSERT INTO events (session_id, type, model, input_tokens, output_tokens, cost_usd, latency_ms, payload, output)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.sessionId,
      params.type,
      params.model ?? null,
      params.inputTokens ?? null,
      params.outputTokens ?? null,
      params.costUsd ?? null,
      params.latencyMs ?? null,
      params.payload ?? null,
      params.output ?? null,
    ]
  )

  if (params.type.startsWith('stage:')) {
    db.run(
      `UPDATE events
       SET payload = NULL, output = NULL
       WHERE type LIKE 'stage:%'
         AND id NOT IN (
           SELECT id FROM events
           WHERE type LIKE 'stage:%'
           ORDER BY id DESC
           LIMIT ?
         )`,
      [LLM_EVENT_LIMIT]
    )
  }
}

