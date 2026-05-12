import { db } from '../db/client'

export type ContactSource = 'email' | 'google_contacts' | 'manual'

export interface Contact {
  id: number
  email: string
  name: string
  aliases: string
  source: ContactSource
  last_seen_at: number | null
  created_at: number
  updated_at: number
}

export function upsertContact(email: string, name: string, source: ContactSource = 'email'): void {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail || !normalizedEmail.includes('@')) return

  db.run(`
    INSERT INTO contacts (email, name, source, last_seen_at)
    VALUES (?, ?, ?, unixepoch())
    ON CONFLICT(email) DO UPDATE SET
      name = CASE
        WHEN excluded.name != '' AND contacts.source != 'manual'
        THEN excluded.name
        ELSE contacts.name
      END,
      source = CASE
        WHEN contacts.source = 'email' AND excluded.source = 'google_contacts'
        THEN 'google_contacts'
        ELSE contacts.source
      END,
      last_seen_at = unixepoch(),
      updated_at = unixepoch()
  `, [normalizedEmail, name.trim(), source])
}

export function lookupContacts(query: string, limit = 5): Contact[] {
  if (!query.trim()) return []

  const tokens = query.trim()
    .replace(/["()^*]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  if (tokens.length === 0) return []

  const ftsQuery = tokens.map(t => `"${t}"*`).join(' OR ')

  try {
    return db.query(`
      SELECT c.id, c.email, c.name, c.aliases, c.source, c.last_seen_at, c.created_at, c.updated_at
      FROM contacts c
      JOIN contacts_fts ON contacts_fts.rowid = c.id
      WHERE contacts_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit) as Contact[]
  } catch {
    // FTS syntax error: fall back to LIKE search
    const like = `%${query.replace(/[%_]/g, '\\$&')}%`
    return db.query(`
      SELECT id, email, name, aliases, source, last_seen_at, created_at, updated_at
      FROM contacts
      WHERE name LIKE ? OR email LIKE ? OR aliases LIKE ?
      ORDER BY last_seen_at DESC NULLS LAST
      LIMIT ?
    `).all(like, like, like, limit) as Contact[]
  }
}

export function listContacts(offset = 0, limit = 50): { contacts: Contact[]; total: number } {
  const { n } = db.query('SELECT COUNT(*) AS n FROM contacts').get() as { n: number }
  const contacts = db.query(`
    SELECT id, email, name, aliases, source, last_seen_at, created_at, updated_at
    FROM contacts
    ORDER BY last_seen_at DESC NULLS LAST, updated_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as Contact[]
  return { contacts, total: n }
}

export function searchContacts(query: string, offset = 0, limit = 50): { contacts: Contact[]; total: number } {
  if (!query.trim()) return listContacts(offset, limit)

  const tokens = query.trim()
    .replace(/["()^*]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  if (tokens.length === 0) return listContacts(offset, limit)

  const ftsQuery = tokens.map(t => `"${t}"*`).join(' OR ')

  try {
    const rows = db.query(`
      SELECT c.id, c.email, c.name, c.aliases, c.source, c.last_seen_at, c.created_at, c.updated_at
      FROM contacts c
      JOIN contacts_fts ON contacts_fts.rowid = c.id
      WHERE contacts_fts MATCH ?
      ORDER BY rank
      LIMIT ? OFFSET ?
    `).all(ftsQuery, limit, offset) as Contact[]

    // Count separately for pagination
    const countRow = db.query(`
      SELECT COUNT(*) AS n
      FROM contacts c
      JOIN contacts_fts ON contacts_fts.rowid = c.id
      WHERE contacts_fts MATCH ?
    `).get(ftsQuery) as { n: number }

    return { contacts: rows, total: countRow.n }
  } catch {
    const like = `%${query.replace(/[%_]/g, '\\$&')}%`
    const rows = db.query(`
      SELECT id, email, name, aliases, source, last_seen_at, created_at, updated_at
      FROM contacts
      WHERE name LIKE ? OR email LIKE ? OR aliases LIKE ?
      ORDER BY last_seen_at DESC NULLS LAST
      LIMIT ? OFFSET ?
    `).all(like, like, like, limit, offset) as Contact[]
    const { n } = db.query(
      `SELECT COUNT(*) AS n FROM contacts WHERE name LIKE ? OR email LIKE ? OR aliases LIKE ?`
    ).get(like, like, like) as { n: number }
    return { contacts: rows, total: n }
  }
}

export function getContact(id: number): Contact | null {
  return db.query(
    'SELECT id, email, name, aliases, source, last_seen_at, created_at, updated_at FROM contacts WHERE id = ?'
  ).get(id) as Contact | null
}

export function deleteContact(id: number): void {
  db.run('DELETE FROM contacts WHERE id = ?', [id])
}

export function addAlias(id: number, alias: string): void {
  const contact = getContact(id)
  if (!contact) return
  const existing = contact.aliases ? contact.aliases.split(',').map(s => s.trim()).filter(Boolean) : []
  const trimmed = alias.trim().toLowerCase()
  if (!trimmed || existing.includes(trimmed)) return
  const updated = [...existing, trimmed].join(',')
  db.run('UPDATE contacts SET aliases = ?, updated_at = unixepoch() WHERE id = ?', [updated, id])
}
