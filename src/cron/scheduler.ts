import { getSetting } from '../db/settings'
import { isPaused } from '../system/pause'
import { generateBrief, type BriefLabel } from '../workflows/morning_brief'
import { sendDbBackup } from './db_backup'

export interface SchedulerOpts {
  gmailUserId: string
  discordUserId: string
}

interface BriefConfig {
  label: BriefLabel
  enabledKey: string
  hourKey: string
}

const BRIEF_CONFIGS: BriefConfig[] = [
  { label: 'morning', enabledKey: 'brief_morning_enabled', hourKey: 'brief_morning_hour' },
  { label: 'midday', enabledKey: 'brief_midday_enabled', hourKey: 'brief_midday_hour' },
  { label: 'evening', enabledKey: 'brief_evening_enabled', hourKey: 'brief_evening_hour' },
]

export function startScheduler(opts: SchedulerOpts): () => void {
  const firedToday = new Set<string>()
  let lastDay = currentDayKey(getSetting('timezone', 'UTC'))

  const timer = setInterval(() => {
    const timezone = getSetting('timezone', 'UTC')
    const dayKey = currentDayKey(timezone)

    if (dayKey !== lastDay) {
      firedToday.clear()
      lastDay = dayKey
    }

    const currentHour = getCurrentHour(timezone)
    const paused = isPaused()

    if (!paused) {
      for (const config of BRIEF_CONFIGS) {
        const enabled = getSetting(config.enabledKey, 'false') === 'true'
        if (!enabled) continue

        const targetHour = parseInt(getSetting(config.hourKey, '8'), 10)
        const fireKey = `${config.label}:${dayKey}`

        if (currentHour === targetHour && !firedToday.has(fireKey)) {
          firedToday.add(fireKey)
          generateBrief({ ...opts, label: config.label }).catch(err => {
            console.error(`[cron] ${config.label} brief failed:`, err)
          })
        }
      }
    }

    const backupEnabled = getSetting('db_backup_enabled', 'true') === 'true'
    if (backupEnabled) {
      const backupHour = parseInt(getSetting('db_backup_hour', '3'), 10)
      const backupFireKey = `db_backup:${dayKey}`
      if (currentHour === backupHour && !firedToday.has(backupFireKey)) {
        firedToday.add(backupFireKey)
        sendDbBackup(opts.discordUserId).catch(err => {
          console.error('[cron] db backup failed:', err)
        })
      }
    }
  }, 60_000)

  return () => clearInterval(timer)
}

function getCurrentHour(timezone: string): number {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }).formatToParts(now)
  const hourPart = parts.find(p => p.type === 'hour')
  return hourPart ? parseInt(hourPart.value, 10) : now.getHours()
}

function currentDayKey(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
}
