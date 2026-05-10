import { db } from '../db/client'

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
    db.run(
      `INSERT OR IGNORE INTO sessions (id, created_at, total_cost_usd) VALUES (?, ?, 0)`,
      [args.sessionId, Date.now()]
    )
  }
  db.run(
    `INSERT INTO pending_approvals (id, action, payload, status, session_id)
     VALUES (?, ?, ?, 'pending', ?)`,
    [id, args.action, JSON.stringify(args.payload ?? {}), args.sessionId ?? null]
  )
  return id
}

export function getApproval(id: string): Approval | null {
  const row = db.query(
    `SELECT id, action, payload, status, session_id, discord_message_id, reject_reason, handler_result, created_at, resolved_at
     FROM pending_approvals WHERE id = ?`
  ).get(id) as RawApprovalRow | null
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
  db.run(
    `UPDATE pending_approvals SET status = 'approved', handler_result = ?, resolved_at = unixepoch() WHERE id = ?`,
    [JSON.stringify(result ?? null), id]
  )
  return { status: 'approved', handler_result: result }
}

export async function rejectApproval(id: string, reason?: string): Promise<void> {
  const a = getApproval(id)
  if (!a) throw new ApprovalStateError(`Approval ${id} not found`)
  if (a.status !== 'pending') {
    throw new ApprovalStateError(`Approval ${id} is ${a.status}, cannot reject`)
  }
  db.run(
    `UPDATE pending_approvals SET status = 'rejected', reject_reason = ?, resolved_at = unixepoch() WHERE id = ?`,
    [reason ?? null, id]
  )
}

export async function expireApproval(id: string): Promise<void> {
  const a = getApproval(id)
  if (!a) throw new ApprovalStateError(`Approval ${id} not found`)
  if (a.status !== 'pending') return
  db.run(
    `UPDATE pending_approvals SET status = 'expired', resolved_at = unixepoch() WHERE id = ?`,
    [id]
  )
}

export function setApprovalDiscordMessage(id: string, discordMessageId: string): void {
  db.run('UPDATE pending_approvals SET discord_message_id = ? WHERE id = ?', [discordMessageId, id])
}

interface RawApprovalRow {
  id: string
  action: string
  payload: string
  status: ApprovalStatus
  session_id: string | null
  discord_message_id: string | null
  reject_reason: string | null
  handler_result: string | null
  created_at: number
  resolved_at: number | null
}

function hydrate(row: RawApprovalRow): Approval {
  return {
    id: row.id,
    action: row.action,
    payload: JSON.parse(row.payload),
    status: row.status,
    session_id: row.session_id,
    discord_message_id: row.discord_message_id,
    reject_reason: row.reject_reason,
    handler_result: row.handler_result == null ? null : JSON.parse(row.handler_result),
    created_at: row.created_at,
    resolved_at: row.resolved_at,
  }
}
