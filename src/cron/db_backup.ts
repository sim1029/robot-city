import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { db } from '../db/client'
import { sendDm, sendDmFile } from '../discord/dm'

const DISCORD_MAX_BYTES = 8 * 1024 * 1024

function resolveDbPath(): string {
  return process.env.DB_PATH ?? join(import.meta.dir, '../../data/robot-city.db')
}

export async function sendDbBackup(discordUserId: string): Promise<void> {
  const dbPath = resolveDbPath()

  if (!existsSync(dbPath)) {
    await sendDm(discordUserId, { content: 'DB backup failed: database file not found.' })
    return
  }

  // Flush WAL frames into the main file before reading it
  db.run('PRAGMA wal_checkpoint(FULL)')

  const proc = Bun.spawn(['gzip', '-c', dbPath], { stdout: 'pipe', stderr: 'inherit' })
  const [compressedBytes, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    await sendDm(discordUserId, { content: 'DB backup failed: gzip exited with an error. Check server logs.' })
    return
  }

  const compressedSize = compressedBytes.byteLength

  if (compressedSize > DISCORD_MAX_BYTES) {
    const sizeMb = (compressedSize / (1024 * 1024)).toFixed(1)
    await sendDm(discordUserId, {
      content: `DB backup too large to attach (${sizeMb} MB compressed, Discord limit 8 MB). Pull from Fly volume manually:\n\`\`\`\nflyctl ssh console -C "cp /data/robot-city.db /tmp/backup.db"\n\`\`\``,
    })
    return
  }

  const dbName = basename(dbPath).replace('.db', '')
  const date = new Date().toISOString().slice(0, 10)
  const filename = `${dbName}-${date}.db.gz`
  const sizeKb = (compressedSize / 1024).toFixed(0)

  await sendDmFile(discordUserId, {
    content: `Daily DB backup — ${date} (${sizeKb} KB compressed)`,
    filename,
    data: compressedBytes,
    contentType: 'application/gzip',
  })

  console.log(`[cron] db backup sent to ${discordUserId} (${sizeKb} KB)`)
}
