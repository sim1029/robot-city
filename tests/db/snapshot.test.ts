import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { snapshotDb } from '../../src/db/snapshot'

describe('snapshotDb', () => {
  let tmpDir: string
  let dbPath: string
  let originalDbPath: string | undefined

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rc-snapshot-'))
    dbPath = join(tmpDir, 'robot-city.db')
    originalDbPath = process.env.DB_PATH
    process.env.DB_PATH = dbPath
  })

  afterEach(() => {
    if (originalDbPath === undefined) delete process.env.DB_PATH
    else process.env.DB_PATH = originalDbPath
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('skips when DB file does not exist', () => {
    const result = snapshotDb()
    expect(result.kind).toBe('skipped')
    expect(existsSync(join(tmpDir, 'snapshots'))).toBe(false)
  })

  test('copies DB to snapshots/ on first call', () => {
    writeFileSync(dbPath, 'sqlite-data-v1')
    const result = snapshotDb()
    expect(result.kind).toBe('created')
    expect(result.path).toBeDefined()
    expect(existsSync(result.path!)).toBe(true)
    expect(result.pruned).toEqual([])

    const snapshots = readdirSync(join(tmpDir, 'snapshots'))
    expect(snapshots).toHaveLength(1)
  })

  test('keeps only the 5 most recent snapshots', () => {
    writeFileSync(dbPath, 'data')

    // Create 6 fake older snapshots with staggered mtimes.
    const snapshotsDir = join(tmpDir, 'snapshots')
    const fs = require('node:fs') as typeof import('node:fs')
    fs.mkdirSync(snapshotsDir, { recursive: true })
    const oldest = join(snapshotsDir, 'robot-city.db.snapshot.2020-01-01T00-00-00-000Z')
    const paths: string[] = []
    for (let i = 0; i < 6; i++) {
      const p = join(snapshotsDir, `robot-city.db.snapshot.2020-01-0${i + 1}T00-00-00-000Z`)
      writeFileSync(p, `old-${i}`)
      const ts = new Date(2020, 0, i + 1).getTime() / 1000
      utimesSync(p, ts, ts)
      paths.push(p)
    }
    expect(paths[0]).toBe(oldest)

    // snapshotDb adds a 7th (newest); rotation should prune to 5 total.
    const result = snapshotDb()
    expect(result.kind).toBe('created')
    expect(result.pruned).toHaveLength(2)
    expect(result.pruned).toContain(paths[0])
    expect(result.pruned).toContain(paths[1])

    const remaining = readdirSync(snapshotsDir)
    expect(remaining).toHaveLength(5)
    expect(remaining.find(n => n === 'robot-city.db.snapshot.2020-01-01T00-00-00-000Z')).toBeUndefined()
  })

  test('snapshot contents match source DB', () => {
    writeFileSync(dbPath, 'unique-payload-xyz')
    const result = snapshotDb()
    const fs = require('node:fs') as typeof import('node:fs')
    const contents = fs.readFileSync(result.path!, 'utf-8')
    expect(contents).toBe('unique-payload-xyz')
  })
})
