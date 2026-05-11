# Admin dashboard + auth design

## Context

robot-city's HTTP surface (`/vault/*`, `/settings/*`, `/cron/brief`, `/events`, `/stages/*`, `/gmail/poll`) is currently **wide open** — no authentication. This is fine when the app runs on localhost, but the upcoming Fly.io deploy puts it on the public internet, where any caller could rotate vault keys, change settings, or read the event log.

This change adds:

1. A Discord-OAuth-backed cookie session for the single configured owner.
2. `requireOwner` + `csrf` middleware that gates everything except a small set of carve-outs.
3. An admin dashboard at `/admin` (HTMX + server-rendered HTML, no build step) covering: cost meter / event log, settings, vault keys, manual action triggers.

Single-user now (one `OWNER_DISCORD_ID` Fly secret), with the table-driven shape we'd need to extend to family/team later already in place.

## Design summary (decisions locked in earlier)

- **Identity provider:** Discord OAuth, `identify` scope. Same Discord OAuth app as the bot install flow (shared client ID/secret); separate route + scope.
- **Owner check:** `OWNER_DISCORD_ID` env var (Fly secret). Mismatch → 403.
- **Session store:** SQLite `admin_sessions` table. 256-bit random session ID. 30-day rolling expiry (touch `last_seen_at` on each authed request).
- **Cookies:**
  - `rc_sess` — HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=30d. Server-side session lookup key.
  - `rc_csrf` — non-HttpOnly, same lifetime. Read by JS, echoed in `X-CSRF-Token` header on mutating requests (double-submit pattern).
- **CSRF:** `SameSite=Lax` cookie + double-submit token on every non-GET request to `/admin/*`.
- **Carve-outs (no auth):** `/health`, `/auth/*` (existing and new), `/login`, `/admin/static/*`. Webhooks (`/webhooks/*`) will be added to carve-outs when they exist (M4+).
- **Dashboard tech:** Hono + JSX (or template literals) returning HTML fragments; HTMX served as a static asset from `/admin/static/htmx.min.js`. **No bundler, no build step** (per CLAUDE.md rule).

## Files to create

### Auth core

- **`src/auth/sessions.ts`** — helpers over `admin_sessions` table:
  - `createSession(discordUserId): {id, csrfToken}` — inserts a row, returns the session id + csrf token.
  - `getSession(id): {discord_user_id, expires_at} | null` — lazy-deletes if expired, otherwise touches `last_seen_at`.
  - `deleteSession(id)` — for logout.
  - `cleanupExpiredSessions()` — called at boot; periodic cleanup not needed otherwise (lazy-delete on read).
- **`src/auth/middleware.ts`** — two Hono middleware:
  - `requireOwner` — reads `rc_sess`, validates session, checks `discord_user_id === OWNER_DISCORD_ID`. On failure: GET → 302 to `/login`, non-GET → 401 JSON.
  - `csrf` — for non-GET/HEAD requests, requires `X-CSRF-Token` header to match `rc_csrf` cookie.
- **`src/auth/discord_login.ts`** — new OAuth login flow (separate from bot install):
  - `GET /auth/discord/login` — generates state, sets short-lived `rc_login_state` cookie, redirects to Discord with `scope=identify`.
  - `GET /auth/discord/login/callback` — validates state, exchanges code, fetches `/users/@me`, checks `OWNER_DISCORD_ID` match, mints session via `createSession`, sets `rc_sess` + `rc_csrf` cookies, 302 to `/admin`.
  - `POST /auth/logout` — deletes session row, clears cookies, 302 to `/login`.

### Schema

- **`src/db/schema.ts`** (edit) — add `admin_sessions` table to `migrate()`:
  ```sql
  CREATE TABLE IF NOT EXISTS admin_sessions (
    id            TEXT PRIMARY KEY,
    discord_user_id TEXT NOT NULL,
    csrf_token    TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,
    last_seen_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);
  ```

### Dashboard

- **`src/admin/layout.ts`** — shared HTML shell. `<head>`, htmx script tag, minimal CSS, nav (Home / Settings / Vault / Actions / Logout), CSRF token injection (`<meta name="csrf-token" content="...">` + tiny inline script reading it into htmx config).
- **`src/admin/home.ts`** — `GET /admin`: cost-this-month meter, last N events table. Reads from `events` table + `getSessionCost`.
- **`src/admin/settings.ts`** — `GET /admin/settings` (form), `POST /admin/settings` (saves all KVs in one shot).
- **`src/admin/vault.ts`** — `GET /admin/vault` (lists providers with "set / not set" + last-rotated date), `POST /admin/vault/:provider` (rotates key — accepts new value, never returns decrypted material), `POST /admin/vault/:provider/delete`.
- **`src/admin/actions.ts`** — `GET /admin/actions` (buttons), `POST /admin/actions/run-brief`, `POST /admin/actions/rebaseline-gmail`.
- **`src/admin/login_page.ts`** — `GET /login`: single "Continue with Discord" button (`<a href="/auth/discord/login">`).

### Static assets

- **`public/admin/htmx.min.js`** — vendored HTMX 2.x (~14KB).
- **`public/admin/styles.css`** — minimal styling: 200-line stylesheet, monospace + system font, dark theme.

Served via `hono/bun` `serveStatic({ root: './public' })` mounted at `/admin/static/*`.

### Wiring (`src/index.ts` edits)

- At top: `if (!process.env.OWNER_DISCORD_ID) console.warn('OWNER_DISCORD_ID not set — admin dashboard will reject all logins')`.
- Mount static handler for `/admin/static/*` **before** the auth middleware.
- Mount new auth routes (`/auth/discord/login`, `/auth/discord/login/callback`, `/auth/logout`).
- Mount `/login` (public).
- Apply `requireOwner` + `csrf` to a route group covering: `/admin/*`, `/vault/*`, `/settings`, `/settings/:key`, `/cron/*`, `/events`, `/stages/*`, `/gmail/poll`.
  - Pattern: `app.use('/vault/*', requireOwner, csrf)` etc., before the existing route definitions. Hono runs middleware in registration order.
- Keep public: `/health`, `/auth/*` (both existing Google/Discord-bot OAuth and new login routes).

## Files to modify (non-trivial)

- **`src/db/schema.ts`** — add `admin_sessions` table to `migrate()`.
- **`src/index.ts`** — wire middleware + new routes (above).
- **`fly.toml`** — no change required; `OWNER_DISCORD_ID` is set via `flyctl secrets set`, not `[env]`.
- **`docs/github-actions-fly-deploy-setup.md`** — add `OWNER_DISCORD_ID` to the `flyctl secrets set` list in the one-time setup section.
- **`CLAUDE.md`** — add `src/auth/` and `src/admin/` to the repo map; add a "Auth = Discord OAuth + cookie sessions; HTTP routes outside `/auth/*` and `/health` are owner-only" line to the Key Decision Log.

## What we deliberately don't do

- **No user/owners table.** Single env-var check. When family-mode arrives later: add `owners` table with claim-on-first-login; the `requireOwner` middleware swaps env-comparison for table-lookup. Same shape, ~10-line diff.
- **No SPA, no bundler.** HTMX + server HTML is the line in the sand — keeps the "Bun runs TS directly, no build step" invariant in CLAUDE.md.
- **No periodic session-cleanup cron.** Lazy delete on read + boot-time cleanup is enough — avoids adding more setInterval state.
- **Vault GETs never return decrypted material.** Dashboard sees `{provider, set: bool, last_rotated_at}`, never the key. POSTs accept new values to write.
- **No password / TOTP / WebAuthn.** Discord OAuth is the only factor. If a future owner wants more, layer it externally (e.g. Cloudflare Access in front).
- **No rate limiting** on `/login` or `/auth/discord/login/callback`. Discord's own rate limits cover OAuth abuse; the `OWNER_DISCORD_ID` equality check means brute-forcing a session via OAuth would require compromising the owner's Discord account itself.

## One-time setup the user does once (add to deploy runbook)

In Discord Developer Portal:
1. Open the existing Discord OAuth app (the one used for the bot).
2. OAuth2 → Redirects → add `https://robot-city.fly.dev/auth/discord/login/callback` as an additional redirect URI (alongside the existing bot install callback).

In Fly:

```
flyctl secrets set OWNER_DISCORD_ID=<your-discord-user-id> --app robot-city
```

To find your Discord user ID: open Discord → Settings → Advanced → enable Developer Mode → right-click your username → "Copy User ID".

## Verification (end-to-end)

After deploy:

1. **Public endpoints still work** without auth:
   - `curl https://robot-city.fly.dev/health` → 200
   - `curl https://robot-city.fly.dev/auth/google` → 302 to Google
2. **Protected endpoints reject anonymous access**:
   - `curl -i https://robot-city.fly.dev/vault/keys/anthropic` → 401 (was 200 before this change)
   - `curl -i https://robot-city.fly.dev/admin` → 302 to `/login`
3. **Login flow works**:
   - Open `https://robot-city.fly.dev/admin` in a browser.
   - Redirected to `/login`, click "Continue with Discord".
   - Discord auth screen → authorize → bounced back, cookie set, land on `/admin`.
4. **Wrong account is rejected**: log in with a different Discord account (or temporarily change `OWNER_DISCORD_ID`) → callback returns 403 "Not the owner."
5. **CSRF rejected**: from a logged-in session, run `curl -b cookies.txt -X POST .../admin/settings` without `X-CSRF-Token` → 403.
6. **CSRF succeeds via the dashboard form** (which auto-injects the token).
7. **Logout deletes the session**: click Logout → cookie cleared → `/admin` 302s to `/login` again. Re-using the old session ID directly via cookie hand-edit → rejected.
8. **Session survives restart**: log in, `flyctl apps restart robot-city`, refresh `/admin` → still logged in (session is in SQLite on the volume).
9. **Existing bot install flow still works**: hit `/auth/discord` (the bot install one) → still goes through with `bot` scope unchanged.

## Critical files referenced (already exist)

- `src/index.ts:25` — `/health` route (stays public).
- `src/index.ts:29-45` — existing `oauthStates` Map pattern for state CSRF. New login flow uses its own `loginStates` Map.
- `src/discord/oauth.ts` — existing Discord OAuth client lib; new login flow shares the helper that hits `/oauth2/token` and `/users/@me`.
- `src/db/schema.ts:migrate()` — where the new table goes.
- `src/db/client.ts` — `db` singleton; new `src/auth/sessions.ts` imports from here.
- `src/vault/index.ts` — routes get `requireOwner` middleware added; no change to the vault logic itself.
- `src/db/settings.ts` — same: middleware added at the route level, no change to KV helpers.

## Staging (optional — implement in one PR or two)

The plan splits cleanly into two PRs if a single PR feels too big:

- **PR 1 (auth core):** new tables/helpers/middleware, login flow, `/admin` page that just says "you're in", apply middleware to existing routes. Proves auth works; protects everything immediately.
- **PR 2 (dashboard surface):** home/settings/vault/actions pages, HTMX assets, styling.

Default: one PR — it's all one feature for the user.
