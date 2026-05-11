import { db } from './client'

export function migrate() {
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      discord_thread_id TEXT UNIQUE,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      closed_at INTEGER,
      total_cost_usd REAL NOT NULL DEFAULT 0
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      type TEXT NOT NULL,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cost_usd REAL,
      latency_ms INTEGER,
      payload TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS vault_keys (
      provider TEXT PRIMARY KEY,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      salt TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS discord_tokens (
      user_id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at INTEGER,
      guild_id TEXT
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS gmail_tokens (
      user_id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      scope TEXT NOT NULL,
      history_id TEXT,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS pending_approvals (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      session_id TEXT,
      discord_message_id TEXT,
      reject_reason TEXT,
      handler_result TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      resolved_at INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `)

  // Additive migration — safe to run against existing DB
  try { db.run('ALTER TABLE events ADD COLUMN output TEXT') } catch { /* already exists */ }

  db.run(`
    CREATE TABLE IF NOT EXISTS user_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      id TEXT PRIMARY KEY,
      discord_user_id TEXT NOT NULL,
      csrf_token TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `)
  db.run('CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at)')

  const settingDefaults: Record<string, string> = {
    brief_morning_enabled: 'true',
    brief_morning_hour: '8',
    brief_midday_enabled: 'false',
    brief_midday_hour: '12',
    brief_evening_enabled: 'false',
    brief_evening_hour: '18',
    timezone: 'UTC',
  }
  for (const [key, value] of Object.entries(settingDefaults)) {
    db.run(`INSERT OR IGNORE INTO user_settings (key, value) VALUES (?, ?)`, [key, value])
  }
}
