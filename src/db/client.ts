import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Absolute path so the DB location is the same regardless of process CWD.
const DB_PATH = process.env.DB_PATH ?? join(import.meta.dir, '../../data/robot-city.db')
mkdirSync(dirname(DB_PATH), { recursive: true })

export const db = new Database(DB_PATH, { create: true })
db.run('PRAGMA journal_mode=WAL')
db.run('PRAGMA foreign_keys=ON')
// Checkpoint any WAL that wasn't flushed by a previous process exit.
db.run('PRAGMA wal_checkpoint(PASSIVE)')

// Flush WAL and close cleanly on Ctrl+C so data is never stranded in the WAL file.
process.on('SIGINT', () => {
  db.close()
  process.exit(0)
})
