import { describe, test, expect } from 'bun:test'
import { isPersonEmail, extractAddress, extractDisplayName } from '../../src/contacts/filter'

describe('isPersonEmail', () => {
  test('accepts a plain person email', () => {
    expect(isPersonEmail('Alice Smith <alice@example.com>')).toBe(true)
  })

  test('accepts a bare email with no display name', () => {
    expect(isPersonEmail('bob@company.org')).toBe(true)
  })

  test('rejects noreply addresses', () => {
    expect(isPersonEmail('noreply@github.com')).toBe(false)
    expect(isPersonEmail('no-reply@twitter.com')).toBe(false)
    expect(isPersonEmail('No Reply <no_reply@service.com>')).toBe(false)
  })

  test('rejects donotreply variants', () => {
    expect(isPersonEmail('donotreply@bank.com')).toBe(false)
    expect(isPersonEmail('do-not-reply@newsletter.com')).toBe(false)
  })

  test('rejects notification addresses', () => {
    expect(isPersonEmail('notifications@github.com')).toBe(false)
    expect(isPersonEmail('notification@service.io')).toBe(false)
  })

  test('rejects mailer-daemon and postmaster', () => {
    expect(isPersonEmail('mailer-daemon@mail.example.com')).toBe(false)
    expect(isPersonEmail('postmaster@example.com')).toBe(false)
  })

  test('rejects generic system addresses', () => {
    expect(isPersonEmail('support@company.com')).toBe(false)
    expect(isPersonEmail('info@company.com')).toBe(false)
    expect(isPersonEmail('admin@company.com')).toBe(false)
    expect(isPersonEmail('hello@company.com')).toBe(false)
    expect(isPersonEmail('team@company.com')).toBe(false)
    expect(isPersonEmail('newsletter@company.com')).toBe(false)
  })

  test('rejects bulk header indicators', () => {
    expect(isPersonEmail('news@company.com', { 'list-id': '<list.company.com>' })).toBe(false)
    expect(isPersonEmail('news@company.com', { 'precedence': 'bulk' })).toBe(false)
    expect(isPersonEmail('news@company.com', { 'list-unsubscribe': '<mailto:unsub@co.com>' })).toBe(false)
  })

  test('rejects bounce+ addresses with long numeric suffix', () => {
    expect(isPersonEmail('bounce+abc1234@mail.example.com')).toBe(false)
  })

  test('rejects missing or malformed email', () => {
    expect(isPersonEmail('')).toBe(false)
    expect(isPersonEmail('not-an-email')).toBe(false)
  })
})

describe('extractAddress', () => {
  test('extracts from angle-bracket format', () => {
    expect(extractAddress('Alice Smith <alice@example.com>')).toBe('alice@example.com')
  })

  test('extracts bare email', () => {
    expect(extractAddress('bob@company.org')).toBe('bob@company.org')
  })

  test('lowercases the result', () => {
    expect(extractAddress('Bob <BOB@COMPANY.COM>')).toBe('bob@company.com')
  })

  test('returns null for non-email strings', () => {
    expect(extractAddress('not an email')).toBeNull()
    expect(extractAddress('')).toBeNull()
  })
})

describe('extractDisplayName', () => {
  test('extracts display name from angle-bracket format', () => {
    expect(extractDisplayName('Alice Smith <alice@example.com>')).toBe('Alice Smith')
  })

  test('strips surrounding quotes', () => {
    expect(extractDisplayName('"Bob Jones" <bob@example.com>')).toBe('Bob Jones')
  })

  test('falls back to email local part for bare emails', () => {
    expect(extractDisplayName('jsmith@company.com')).toBe('jsmith')
  })

  test('converts dots and underscores to spaces in local part', () => {
    expect(extractDisplayName('j.smith@company.com')).toBe('j smith')
  })
})
