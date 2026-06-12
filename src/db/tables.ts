import { sql } from 'drizzle-orm'
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Drizzle table definitions mirroring the DDL in schema.ts migrate().
// schema.ts remains the source of truth for table creation (boot-time,
// idempotent); these definitions exist for typed queries. Keep both in sync.
// The contacts_fts virtual table + triggers are FTS5 and stay raw-SQL only.

const unixepoch = sql`(unixepoch())`

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  discordThreadId: text('discord_thread_id').unique(),
  createdAt: integer('created_at').notNull().default(unixepoch),
  closedAt: integer('closed_at'),
  totalCostUsd: real('total_cost_usd').notNull().default(0),
})

export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').references(() => sessions.id),
  type: text('type').notNull(),
  model: text('model'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  costUsd: real('cost_usd'),
  latencyMs: integer('latency_ms'),
  payload: text('payload'),
  output: text('output'),
  createdAt: integer('created_at').notNull().default(unixepoch),
})

export const vaultKeys = sqliteTable('vault_keys', {
  provider: text('provider').primaryKey(),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  salt: text('salt').notNull(),
  updatedAt: integer('updated_at').notNull().default(unixepoch),
})

export const discordTokens = sqliteTable('discord_tokens', {
  userId: text('user_id').primaryKey(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  expiresAt: integer('expires_at'),
  guildId: text('guild_id'),
})

export const gmailTokens = sqliteTable('gmail_tokens', {
  userId: text('user_id').primaryKey(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: integer('expires_at').notNull(),
  scope: text('scope').notNull(),
  historyId: text('history_id'),
  updatedAt: integer('updated_at').notNull().default(unixepoch),
})

export const pendingApprovals = sqliteTable('pending_approvals', {
  id: text('id').primaryKey(),
  action: text('action').notNull(),
  payload: text('payload').notNull(),
  status: text('status').notNull().default('pending'),
  sessionId: text('session_id').references(() => sessions.id),
  discordMessageId: text('discord_message_id'),
  rejectReason: text('reject_reason'),
  handlerResult: text('handler_result'),
  createdAt: integer('created_at').notNull().default(unixepoch),
  resolvedAt: integer('resolved_at'),
})

export const userSettings = sqliteTable('user_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull().default(unixepoch),
})

export const adminSessions = sqliteTable('admin_sessions', {
  id: text('id').primaryKey(),
  discordUserId: text('discord_user_id').notNull(),
  csrfToken: text('csrf_token').notNull(),
  createdAt: integer('created_at').notNull().default(unixepoch),
  expiresAt: integer('expires_at').notNull(),
  lastSeenAt: integer('last_seen_at').notNull().default(unixepoch),
})

export const contacts = sqliteTable('contacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').unique().notNull(),
  name: text('name').notNull().default(''),
  aliases: text('aliases').notNull().default(''),
  source: text('source').notNull().default('email'),
  lastSeenAt: integer('last_seen_at'),
  createdAt: integer('created_at').notNull().default(unixepoch),
  updatedAt: integer('updated_at').notNull().default(unixepoch),
})
