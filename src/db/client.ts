import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const DB_PATH = process.env.DB_PATH ?? './data/robot-city.db'
mkdirSync(dirname(DB_PATH), { recursive: true })

export const db = new Database(DB_PATH, { create: true })
db.run('PRAGMA journal_mode=WAL')
db.run('PRAGMA foreign_keys=ON')
