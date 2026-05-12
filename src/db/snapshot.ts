import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const KEEP_SNAPSHOTS = 5
const SNAPSHOT_PREFIX = '.snapshot.'

function resolveDbPath(): string {
  return process.env.DB_PATH ?? join(import.meta.dir, '../../data/robot-city.db')
}

export interface SnapshotResult {
  kind: 'skipped' | 'created'
  path?: string
  pruned: string[]
}

export function snapshotDb(): SnapshotResult {
  const dbPath = resolveDbPath()
  if (!existsSync(dbPath)) {
    return { kind: 'skipped', pruned: [] }
  }

  const dbDir = dirname(dbPath)
  const dbName = basename(dbPath)
  const snapshotsDir = join(dbDir, 'snapshots')
  mkdirSync(snapshotsDir, { recursive: true })

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const snapshotPath = join(snapshotsDir, `${dbName}${SNAPSHOT_PREFIX}${timestamp}`)
  copyFileSync(dbPath, snapshotPath)

  const pruned = pruneOldSnapshots(snapshotsDir, dbName)
  console.log(`[db] snapshot saved: ${snapshotPath}`)
  if (pruned.length > 0) {
    console.log(`[db] pruned ${pruned.length} old snapshot(s)`)
  }
  return { kind: 'created', path: snapshotPath, pruned }
}

function pruneOldSnapshots(snapshotsDir: string, dbName: string): string[] {
  const matchPrefix = `${dbName}${SNAPSHOT_PREFIX}`
  const entries = readdirSync(snapshotsDir)
    .filter(name => name.startsWith(matchPrefix))
    .map(name => {
      const fullPath = join(snapshotsDir, name)
      return { name, fullPath, mtimeMs: statSync(fullPath).mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)

  const toPrune = entries.slice(KEEP_SNAPSHOTS)
  const pruned: string[] = []
  for (const entry of toPrune) {
    unlinkSync(entry.fullPath)
    pruned.push(entry.fullPath)
  }
  return pruned
}
