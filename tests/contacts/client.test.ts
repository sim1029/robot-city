import { describe, test, expect, beforeAll, beforeEach } from 'bun:test'
import { db } from '../../src/db/client'
import { migrate } from '../../src/db/schema'
import { upsertContact, lookupContacts, listContacts, deleteContact, addAlias } from '../../src/contacts/client'

beforeAll(() => {
  migrate()
})

beforeEach(() => {
  db.run('DELETE FROM contacts')
  // Rebuild FTS index after deleting rows
  db.run(`INSERT INTO contacts_fts(contacts_fts) VALUES ('rebuild')`)
})

describe('upsertContact', () => {
  test('inserts a new contact', () => {
    upsertContact('alice@example.com', 'Alice Smith')
    const { contacts } = listContacts()
    expect(contacts).toHaveLength(1)
    expect(contacts[0].email).toBe('alice@example.com')
    expect(contacts[0].name).toBe('Alice Smith')
    expect(contacts[0].source).toBe('email')
  })

  test('normalises email to lowercase', () => {
    upsertContact('BOB@COMPANY.COM', 'Bob')
    const { contacts } = listContacts()
    expect(contacts[0].email).toBe('bob@company.com')
  })

  test('updates name on second upsert when source is not manual', () => {
    upsertContact('alice@example.com', 'Alice')
    upsertContact('alice@example.com', 'Alice Smith')
    const { contacts } = listContacts()
    expect(contacts).toHaveLength(1)
    expect(contacts[0].name).toBe('Alice Smith')
  })

  test('does not overwrite name for manual contacts', () => {
    upsertContact('alice@example.com', 'Alice Manual', 'manual')
    upsertContact('alice@example.com', 'Alice Email', 'email')
    const { contacts } = listContacts()
    expect(contacts[0].name).toBe('Alice Manual')
  })

  test('upgrades source from email to google_contacts', () => {
    upsertContact('alice@example.com', 'Alice', 'email')
    upsertContact('alice@example.com', 'Alice Smith', 'google_contacts')
    const { contacts } = listContacts()
    expect(contacts[0].source).toBe('google_contacts')
  })

  test('ignores invalid emails', () => {
    upsertContact('', 'Nobody')
    upsertContact('notanemail', 'Nobody')
    const { contacts } = listContacts()
    expect(contacts).toHaveLength(0)
  })
})

describe('lookupContacts', () => {
  beforeEach(() => {
    upsertContact('alice@example.com', 'Alice Smith')
    upsertContact('bob@company.com', 'Robert Jones')
    upsertContact('carol@work.io', 'Carol White')
  })

  test('finds by exact name prefix', () => {
    const results = lookupContacts('Alice')
    expect(results).toHaveLength(1)
    expect(results[0].email).toBe('alice@example.com')
  })

  test('finds by email prefix', () => {
    const results = lookupContacts('carol@')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].email).toBe('carol@work.io')
  })

  test('finds by last name', () => {
    const results = lookupContacts('Jones')
    expect(results).toHaveLength(1)
    expect(results[0].email).toBe('bob@company.com')
  })

  test('returns empty for no match', () => {
    const results = lookupContacts('xyznotfound')
    expect(results).toHaveLength(0)
  })

  test('returns empty for blank query', () => {
    expect(lookupContacts('')).toHaveLength(0)
    expect(lookupContacts('   ')).toHaveLength(0)
  })

  test('respects limit', () => {
    const results = lookupContacts('example', 1)
    expect(results.length).toBeLessThanOrEqual(1)
  })
})

describe('deleteContact', () => {
  test('removes the contact', () => {
    upsertContact('del@example.com', 'Delete Me')
    const { contacts } = listContacts()
    deleteContact(contacts[0].id)
    expect(listContacts().contacts).toHaveLength(0)
  })

  test('silently ignores unknown id', () => {
    expect(() => deleteContact(99999)).not.toThrow()
  })
})

describe('addAlias', () => {
  test('adds an alias', () => {
    upsertContact('alice@example.com', 'Alice Smith')
    const { contacts } = listContacts()
    addAlias(contacts[0].id, 'Allie')
    const updated = listContacts().contacts[0]
    expect(updated.aliases).toContain('allie')
  })

  test('does not duplicate alias', () => {
    upsertContact('alice@example.com', 'Alice Smith')
    const { contacts } = listContacts()
    addAlias(contacts[0].id, 'Allie')
    addAlias(contacts[0].id, 'Allie')
    const updated = listContacts().contacts[0]
    expect(updated.aliases.split(',').filter(Boolean)).toHaveLength(1)
  })
})
