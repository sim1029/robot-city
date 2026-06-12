import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as tables from './tables'

// Absolute path so the DB location is the same regardless of process CWD.
const DB_PATH = process.env.DB_PATH ?? join(import.meta.dir, '../../data/robot-city.db')
mkdirSync(dirname(DB_PATH), { recursive: true })

// Raw handle: boot-time DDL in schema.ts, PRAGMAs, and FTS5 queries only.
// All other queries go through the Drizzle `db` instance.
export const sqlite = new Database(DB_PATH, { create: true })
sqlite.run('PRAGMA journal_mode=WAL')
sqlite.run('PRAGMA foreign_keys=ON')
// Checkpoint any WAL that wasn't flushed by a previous process exit.
sqlite.run('PRAGMA wal_checkpoint(PASSIVE)')

export const db = drizzle(sqlite, { schema: tables })

// Flush WAL and close cleanly on Ctrl+C so data is never stranded in the WAL file.
process.on('SIGINT', () => {
  sqlite.close()
  process.exit(0)
})
