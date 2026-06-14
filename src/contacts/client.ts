import { count, eq, like, or, sql } from 'drizzle-orm'
import { db, sqlite } from '../db/client'
import { contacts } from '../db/tables'

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

function toContact(row: typeof contacts.$inferSelect): Contact {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    aliases: row.aliases,
    source: row.source as ContactSource,
    last_seen_at: row.lastSeenAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

export function upsertContact(email: string, name: string, source: ContactSource = 'email'): void {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail || !normalizedEmail.includes('@')) return

  db.insert(contacts)
    .values({ email: normalizedEmail, name: name.trim(), source, lastSeenAt: sql`unixepoch()` })
    .onConflictDoUpdate({
      target: contacts.email,
      set: {
        name: sql`CASE
          WHEN excluded.name != '' AND ${contacts.source} != 'manual'
          THEN excluded.name
          ELSE ${contacts.name}
        END`,
        source: sql`CASE
          WHEN ${contacts.source} = 'email' AND excluded.source = 'google_contacts'
          THEN 'google_contacts'
          ELSE ${contacts.source}
        END`,
        lastSeenAt: sql`unixepoch()`,
        updatedAt: sql`unixepoch()`,
      },
    })
    .run()
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
    // FTS5 MATCH + rank are virtual-table features Drizzle can't model — raw SQL.
    return sqlite.query(`
      SELECT c.id, c.email, c.name, c.aliases, c.source, c.last_seen_at, c.created_at, c.updated_at
      FROM contacts c
      JOIN contacts_fts ON contacts_fts.rowid = c.id
      WHERE contacts_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit) as Contact[]
  } catch {
    // FTS syntax error: fall back to LIKE search
    const pattern = `%${query.replace(/[%_]/g, '\\$&')}%`
    return db.select()
      .from(contacts)
      .where(or(like(contacts.name, pattern), like(contacts.email, pattern), like(contacts.aliases, pattern)))
      .orderBy(sql`${contacts.lastSeenAt} DESC NULLS LAST`)
      .limit(limit)
      .all()
      .map(toContact)
  }
}

export function listContacts(offset = 0, limit = 50): { contacts: Contact[]; total: number } {
  const { n } = db.select({ n: count() }).from(contacts).get()!
  const rows = db.select()
    .from(contacts)
    .orderBy(sql`${contacts.lastSeenAt} DESC NULLS LAST`, sql`${contacts.updatedAt} DESC`)
    .limit(limit)
    .offset(offset)
    .all()
  return { contacts: rows.map(toContact), total: n }
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
    // FTS5 MATCH + rank are virtual-table features Drizzle can't model — raw SQL.
    const rows = sqlite.query(`
      SELECT c.id, c.email, c.name, c.aliases, c.source, c.last_seen_at, c.created_at, c.updated_at
      FROM contacts c
      JOIN contacts_fts ON contacts_fts.rowid = c.id
      WHERE contacts_fts MATCH ?
      ORDER BY rank
      LIMIT ? OFFSET ?
    `).all(ftsQuery, limit, offset) as Contact[]

    // Count separately for pagination
    const countRow = sqlite.query(`
      SELECT COUNT(*) AS n
      FROM contacts c
      JOIN contacts_fts ON contacts_fts.rowid = c.id
      WHERE contacts_fts MATCH ?
    `).get(ftsQuery) as { n: number }

    return { contacts: rows, total: countRow.n }
  } catch {
    const pattern = `%${query.replace(/[%_]/g, '\\$&')}%`
    const matches = or(like(contacts.name, pattern), like(contacts.email, pattern), like(contacts.aliases, pattern))
    const rows = db.select()
      .from(contacts)
      .where(matches)
      .orderBy(sql`${contacts.lastSeenAt} DESC NULLS LAST`)
      .limit(limit)
      .offset(offset)
      .all()
    const { n } = db.select({ n: count() }).from(contacts).where(matches).get()!
    return { contacts: rows.map(toContact), total: n }
  }
}

export function getContact(id: number): Contact | null {
  const row = db.select().from(contacts).where(eq(contacts.id, id)).get()
  return row ? toContact(row) : null
}

export function deleteContact(id: number): void {
  db.delete(contacts).where(eq(contacts.id, id)).run()
}

export function addAlias(id: number, alias: string): void {
  const contact = getContact(id)
  if (!contact) return
  const existing = contact.aliases ? contact.aliases.split(',').map(s => s.trim()).filter(Boolean) : []
  const trimmed = alias.trim().toLowerCase()
  if (!trimmed || existing.includes(trimmed)) return
  const updated = [...existing, trimmed].join(',')
  db.update(contacts).set({ aliases: updated, updatedAt: sql`unixepoch()` }).where(eq(contacts.id, id)).run()
}
