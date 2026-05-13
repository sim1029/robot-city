# Contact Management Feature Plan

## Goal

Maintain a contacts database so the user can say "send an email to Bob" without knowing Bob's email address. New senders are learned passively from incoming Gmail; Google Contacts is synced on demand to seed the full address book.

## Architecture

### Storage — `contacts` table + FTS5 virtual table

```sql
contacts(id, email UNIQUE, name, aliases, source, last_seen_at, created_at, updated_at)
contacts_fts USING fts5(email, name, aliases, content=contacts, content_rowid=id)
```

Three triggers (`contacts_fts_insert`, `contacts_fts_update`, `contacts_fts_delete`) keep the FTS index in sync automatically. All schema changes are additive and safe for `flyctl releases rollback`.

### Filtering non-person emails — `src/contacts/filter.ts`

`isPersonEmail(fromHeader, extraHeaders)` returns `false` when:
- `List-ID`, `List-Unsubscribe`, or `X-Mailchimp-Campaign-ID` headers are present
- `Precedence: bulk | list | junk`
- The local part of the address matches a blocked pattern (noreply, no-reply, donotreply, notifications, mailer-daemon, postmaster, support, info, admin, team, hello, newsletter, updates, alerts, automated, unsubscribe, reply, deals, promotions, billing, security, receipts, orders, shipping, feedback)
- The local part contains `+` plus 4+ digits (automated bounce routing)

### Contact ingestion — `src/gmail/triage_loop.ts`

After each `triageMessage` call, `isPersonEmail` is checked on the `from` header. If it passes, `upsertContact(email, displayName, 'email')` is called. No LLM cost, no API call.

### Google Contacts sync — `src/contacts/sync.ts`

`syncGoogleContacts(accessToken)` calls `GET /v1/people/me/connections?personFields=names,emailAddresses` with pagination, upserting every person with an email. The new `contacts.readonly` scope was added to `GMAIL_SCOPES` in `oauth.ts` — users must re-auth at `/auth/google` to grant it.

### Fuzzy search — FTS5 + LLM disambiguation

`lookupContacts(query, limit)` builds prefix token queries (`"alice"* OR "smith"*`) against the FTS5 virtual table. FTS5 handles partial matches and token ranking. On FTS syntax error it falls back to LIKE search.

For the "Bob = Robert" problem: the gather stage returns the top 5 candidates as context to the reason stage (Sonnet). Sonnet knows common nickname mappings and picks the right one.

### Pipeline integration — `src/stages/gather.ts`

When the classify stage output contains `SEND_EMAIL`, `gatherForIntent` extracts a recipient name hint (words after "to" that look like proper nouns), queries `lookupContacts`, and returns the candidates as `[CONTACTS - matches for "X"]\n• Name <email>` context. The reason stage then uses this to fill the `to` field without asking the user.

### Admin UI — `/admin/contacts`

- Search bar with HTMX live search (300ms debounce) backed by `contacts_fts`
- Table: Name | Email | Aliases | Source | Last seen | Delete
- "Sync Google Contacts" button posts to `/admin/contacts/sync` → calls `syncGoogleContacts`
- Mobile: Source and Last seen columns hidden via `.contacts-hide-mobile`
- Pagination via load-more rows (same HTMX pattern as the events table)

## Files changed

| File | Change |
|---|---|
| `src/contacts/filter.ts` | New — `isPersonEmail`, `extractAddress`, `extractDisplayName` |
| `src/contacts/client.ts` | New — `upsertContact`, `lookupContacts`, `searchContacts`, `listContacts`, `deleteContact`, `addAlias` |
| `src/contacts/sync.ts` | New — `syncGoogleContacts` (Google People API) |
| `src/db/schema.ts` | Added `contacts` table, `contacts_fts` virtual table, 3 sync triggers |
| `src/gmail/oauth.ts` | Added `contacts.readonly` scope |
| `src/gmail/triage_loop.ts` | Auto-ingest sender after each triage message |
| `src/stages/gather.ts` | Contact lookup for `SEND_EMAIL` intent |
| `src/admin/contacts.tsx` | New admin page |
| `src/admin/router.ts` | Registered `/contacts` route |
| `src/admin/components/Layout.tsx` | Added Contacts nav link |
| `public/admin/static/styles.css` | Added `.btn-sm`, `input[type="search"]`, `.contacts-hide-mobile` |
| `tests/contacts/filter.test.ts` | Unit tests for filter heuristics |
| `tests/contacts/client.test.ts` | Unit tests for DB ops + FTS search |

## Re-auth required

The new `contacts.readonly` scope means existing users need to re-authenticate at `/auth/google`. The sync button on the contacts page will fail until this is done (shows an error message rather than silently failing).

## Decisions made

- **No vector embeddings.** FTS5 prefix search + Sonnet disambiguation covers the nickname problem at zero marginal cost.
- **No background sync.** Google Contacts sync is user-triggered from the admin UI. Passive email ingestion handles the ongoing case automatically.
- **Source priority.** Manual > Google Contacts > Email (name and source only upgrade, never downgrade).
- **Aliases are manual-only for now.** The admin UI will eventually expose an edit form; the `addAlias` function is in place.
