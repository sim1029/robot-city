import { eq, sql } from 'drizzle-orm'
import { db } from './client'
import { userSettings } from './tables'

export function getSetting(key: string, defaultValue: string): string {
  const row = db.select({ value: userSettings.value }).from(userSettings).where(eq(userSettings.key, key)).get()
  return row?.value ?? defaultValue
}

export function setSetting(key: string, value: string): void {
  db.insert(userSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: userSettings.key,
      set: { value: sql`excluded.value`, updatedAt: sql`unixepoch()` },
    })
    .run()
}

export function getAllSettings(): Record<string, string> {
  const rows = db.select({ key: userSettings.key, value: userSettings.value }).from(userSettings).all()
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}
