# Local dev forum scoping + SQLite snapshots + PR CI

## Context

The original idea was per-PR ephemeral fly.io environments so cloud Claude Code agents could push PRs and the changes could be exercised before merge. The OAuth callback story (Discord + Google redirect URIs must be pre-registered) made this disproportionately painful for a single-user personal app. Cross-environment token seeding from prod is technically possible but introduces real risks (Gmail `history_id` watermark race between prod and ephemeral envs would cause duplicate or missed triages).

**Revised model:** single prod fly.io app + local dev. Agents push PRs to `main`. CI runs typecheck + tests on each PR. The owner eyeballs the diff and merges. Bad changes get reverted with `git revert` + `flyctl releases rollback`. SQLite snapshots provide a fallback for data corruption. "Fix forward" is acceptable because the app is personal-scale.

This plan covers the three pieces of work needed for that model.

## Part A: Env-driven forum scoping

Today both `src/discord/bot.ts` and `src/discord/setup.ts` hardcode the forum name `robot-city`. That works for prod but means a local dev instance using the same bot token would either fight prod for the same forum or fail to find its own.

### New env vars (added to `.env.example`)

- `DISCORD_FORUM_NAME` — default `robot-city`. Local dev sets `robot-city-dev`.
- `DISCORD_GUILD_ID` — optional. Overrides the `discord_tokens.guild_id` DB lookup. Useful for local dev so you don't need to run `bun run init` against your dev DB.

### New module `src/discord/forum.ts`

- `resolveForumChannel(): Promise<{ guildId, forumId, forumName }>`
  - Resolves guild ID: env `DISCORD_GUILD_ID` first, falls back to `SELECT guild_id FROM discord_tokens LIMIT 1`.
  - Resolves forum name from `DISCORD_FORUM_NAME` (default `robot-city`).
  - Looks up the forum by name in that guild via Discord REST; creates it if missing (reuses logic from `setup.ts`).
  - Caches the resolved IDs at module scope.
- `getResolvedForumId(): string` — synchronous accessor for handlers that need the ID after resolution.

### Changes to existing files

- `src/discord/bot.ts` — call `resolveForumChannel()` before attaching event listeners. Replace both `parent.name === 'robot-city'` checks with `parent.id === getResolvedForumId()`. Filtering by ID is more robust and lets multiple `robot-city*` forums coexist in the same guild.
- `src/discord/setup.ts` — generalize `getOrCreateForumChannel(guildId, forumName = 'robot-city')`. `cli/init.ts` continues to pass the default.

### Prod safety

Prod's fly app has no `DISCORD_FORUM_NAME` env var → defaults to `robot-city` → finds the existing forum by name → caches its ID → bot behaves identically to today. No migration required.

## Part B: SQLite snapshots on boot

### Persistence vs backup — important distinction

The DB already persists across deploys because of the fly volume mount at `/data`. Deploys swap the container image; the volume stays. OAuth tokens survive every deploy today.

**Snapshots are backups, not the persistence mechanism.** They protect against the case where new code corrupts the live DB (bad migration, accidental destructive write). The volume is what keeps you logged in; the snapshot is the "oh shit, restore yesterday's state" lifeline.

### New module `src/db/snapshot.ts`

- `snapshotDb()`:
  1. Resolves DB path from `process.env.DB_PATH` (default `./data/robot-city.db`, matching `db/client.ts`).
  2. If the DB file doesn't exist yet (first-ever boot), no-op silently.
  3. Computes snapshot path: `<dirname>/snapshots/robot-city.db.<ISO-timestamp>`.
  4. Copies the file (`fs.copyFileSync`).
  5. Lists existing snapshots in the snapshots dir, sorts by mtime desc, deletes everything past index 4 (keeps 5 most recent).
  6. Logs `[db] snapshot saved: <path>`.

### Wire-in

Call `snapshotDb()` in `src/index.ts` immediately before `migrate()` runs. Every container boot snapshots pre-migration state. The snapshots dir lives inside `/data` so it's on the persisted volume.

### Restore (manual, rare)

```
flyctl ssh console -a robot-city
cp /data/snapshots/robot-city.db.<timestamp> /data/robot-city.db
exit
flyctl machine restart
```

Documented in CLAUDE.md.

### Test

Unit test in `tests/db/snapshot.test.ts`: against a tmp dir, create a fake DB file, run `snapshotDb()` 6 times with synthetic timestamps, assert exactly 5 files remain and the oldest got pruned.

## Part C: PR CI

Modify `.github/workflows/deploy.yml`:

- Add `pull_request: branches: [main]` to the triggers list alongside the existing `push: branches: [main]` and `workflow_dispatch`.
- The `verify` job (typecheck + test) runs on every trigger automatically.
- Gate the `deploy` job: `if: github.event_name == 'push' || github.event_name == 'workflow_dispatch'`. PRs run tests but never deploy.

Fork PRs from anyone on GitHub will trigger `verify` too (read-only `GITHUB_TOKEN`, no secrets access — verify needs no secrets). They can't deploy. Good public-repo posture for free.

## Part D: CLAUDE.md touchups

- Decision log entry: single fly app, no ephemeral envs. Rollback = `flyctl releases rollback` for code; manual `cp` from `/data/snapshots/` for data. Migrations must be strictly additive so rollbacks don't crash on schema mismatch.
- Things-to-NOT-do entry: don't write destructive schema migrations (drop column, destructive rename). Deprecate first, drop in a later release.
- Repo map: add `src/discord/forum.ts`, `src/db/snapshot.ts`, note `/data/snapshots/` on the volume.

## Out of scope (explicit)

- Ephemeral PR fly apps
- Token seeding / cross-env OAuth
- Wildcard redirect URIs
- Automated restore CLI (manual `flyctl ssh` + `cp` is fine for solo)
- Slack/discord notifications when CI fails on a PR
