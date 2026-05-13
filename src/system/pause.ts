import { getSetting, setSetting } from '../db/settings'

const KEY = 'paused'

export function isPaused(): boolean {
  return getSetting(KEY, 'false') === 'true'
}

export function setPaused(value: boolean, source: 'admin' | 'discord'): void {
  setSetting(KEY, value ? 'true' : 'false')
  console.log(`[pause] ${source} -> paused=${value}`)
}
