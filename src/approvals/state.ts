import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { pendingApprovals, sessions } from '../db/tables'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export class ApprovalStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApprovalStateError'
  }
}

export interface Approval {
  id: string
  action: string
  payload: unknown
  status: ApprovalStatus
  session_id: string | null
  discord_message_id: string | null
  reject_reason: string | null
  handler_result: unknown
  created_at: number
  resolved_at: number | null
}

export type ApprovalHandler = (payload: unknown, approval: Approval) => Promise<unknown>

const handlers = new Map<string, ApprovalHandler>()

export function registerApprovalHandler(action: string, handler: ApprovalHandler): void {
  handlers.set(action, handler)
}

export function resetApprovalHandlersForTest(): void {
  handlers.clear()
}

export interface CreateArgs {
  action: string
  payload: unknown
  sessionId?: string | null
}

export function createApproval(args: CreateArgs): string {
  const id = crypto.randomUUID()
  if (args.sessionId) {
    db.insert(sessions)
      .values({ id: args.sessionId, createdAt: Date.now(), totalCostUsd: 0 })
      .onConflictDoNothing()
      .run()
  }
  db.insert(pendingApprovals)
    .values({
      id,
      action: args.action,
      payload: JSON.stringify(args.payload ?? {}),
      status: 'pending',
      sessionId: args.sessionId ?? null,
    })
    .run()
  return id
}

export function getApproval(id: string): Approval | null {
  const row = db.select().from(pendingApprovals).where(eq(pendingApprovals.id, id)).get()
  if (!row) return null
  return hydrate(row)
}

export interface ApprovedResult {
  status: 'approved'
  handler_result: unknown
}

export async function approveApproval(id: string): Promise<ApprovedResult> {
  const a = getApproval(id)
  if (!a) throw new ApprovalStateError(`Approval ${id} not found`)
  if (a.status !== 'pending') {
    throw new ApprovalStateError(`Approval ${id} is ${a.status}, cannot approve`)
  }
  const handler = handlers.get(a.action)
  if (!handler) throw new Error(`No handler registered for action "${a.action}"`)

  const result = await handler(a.payload, a)
  db.update(pendingApprovals)
    .set({ status: 'approved', handlerResult: JSON.stringify(result ?? null), resolvedAt: sql`unixepoch()` })
    .where(eq(pendingApprovals.id, id))
    .run()
  return { status: 'approved', handler_result: result }
}

export async function rejectApproval(id: string, reason?: string): Promise<void> {
  const a = getApproval(id)
  if (!a) throw new ApprovalStateError(`Approval ${id} not found`)
  if (a.status !== 'pending') {
    throw new ApprovalStateError(`Approval ${id} is ${a.status}, cannot reject`)
  }
  db.update(pendingApprovals)
    .set({ status: 'rejected', rejectReason: reason ?? null, resolvedAt: sql`unixepoch()` })
    .where(eq(pendingApprovals.id, id))
    .run()
}

export async function expireApproval(id: string): Promise<void> {
  const a = getApproval(id)
  if (!a) throw new ApprovalStateError(`Approval ${id} not found`)
  if (a.status !== 'pending') return
  db.update(pendingApprovals)
    .set({ status: 'expired', resolvedAt: sql`unixepoch()` })
    .where(eq(pendingApprovals.id, id))
    .run()
}

export function setApprovalDiscordMessage(id: string, discordMessageId: string): void {
  db.update(pendingApprovals).set({ discordMessageId }).where(eq(pendingApprovals.id, id)).run()
}

export function updateApprovalPayload(id: string, patch: Record<string, unknown>): void {
  const a = getApproval(id)
  if (!a) throw new ApprovalStateError(`Approval ${id} not found`)
  if (a.status !== 'pending') throw new ApprovalStateError(`Approval ${id} is ${a.status}, cannot update payload`)
  const merged = { ...(a.payload as Record<string, unknown>), ...patch }
  db.update(pendingApprovals).set({ payload: JSON.stringify(merged) }).where(eq(pendingApprovals.id, id)).run()
}

function hydrate(row: typeof pendingApprovals.$inferSelect): Approval {
  return {
    id: row.id,
    action: row.action,
    payload: JSON.parse(row.payload),
    status: row.status as ApprovalStatus,
    session_id: row.sessionId,
    discord_message_id: row.discordMessageId,
    reject_reason: row.rejectReason,
    handler_result: row.handlerResult == null ? null : JSON.parse(row.handlerResult),
    created_at: row.createdAt,
    resolved_at: row.resolvedAt,
  }
}
