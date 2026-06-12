import { and, desc, like, notInArray } from 'drizzle-orm'
import { db } from './client'
import { events } from './tables'

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
  db.insert(events).values({
    sessionId: params.sessionId,
    type: params.type,
    model: params.model ?? null,
    inputTokens: params.inputTokens ?? null,
    outputTokens: params.outputTokens ?? null,
    costUsd: params.costUsd ?? null,
    latencyMs: params.latencyMs ?? null,
    payload: params.payload ?? null,
    output: params.output ?? null,
  }).run()

  if (params.type.startsWith('stage:')) {
    const recentStageIds = db.select({ id: events.id })
      .from(events)
      .where(like(events.type, 'stage:%'))
      .orderBy(desc(events.id))
      .limit(LLM_EVENT_LIMIT)
    db.update(events)
      .set({ payload: null, output: null })
      .where(and(like(events.type, 'stage:%'), notInArray(events.id, recentStageIds)))
      .run()
  }
}
