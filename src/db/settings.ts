import { db } from './client'

export function getSetting(key: string, defaultValue: string): string {
  const row = db.query('SELECT value FROM user_settings WHERE key = ?').get(key) as { value: string } | null
  return row?.value ?? defaultValue
}

export function setSetting(key: string, value: string): void {
  db.run(
    `INSERT INTO user_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`,
    [key, value]
  )
}

export function getAllSettings(): Record<string, string> {
  const rows = db.query('SELECT key, value FROM user_settings').all() as Array<{ key: string; value: string }>
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}
