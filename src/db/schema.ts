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
}
