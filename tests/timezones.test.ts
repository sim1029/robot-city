import { describe, expect, test } from 'bun:test'
import { timezoneOptions, validateTimezone } from '../src/timezones'

describe('timezones', () => {
  test('normalizes legacy eastern abbreviations to New York time', () => {
    expect(validateTimezone('EST')).toEqual({ ok: true, value: 'America/New_York' })
    expect(validateTimezone('EDT')).toEqual({ ok: true, value: 'America/New_York' })
  })

  test('rejects values outside the timezone list', () => {
    expect(validateTimezone('Mars/Olympus_Mons')).toEqual({ ok: false, error: 'Choose a timezone from the list.' })
  })

  test('puts common timezones before the full global list', () => {
    const options = timezoneOptions(new Date('2026-05-22T12:00:00Z'))
    const newYork = options.findIndex((option) => option.value === 'America/New_York')
    const abidjan = options.findIndex((option) => option.value === 'Africa/Abidjan')

    expect(newYork).toBeGreaterThanOrEqual(0)
    expect(abidjan).toBeGreaterThanOrEqual(0)
    expect(newYork).toBeLessThan(abidjan)
  })
})
