# robot-city — v1 Spec

## Vision

A self-hosted, single-user AI life concierge that turns your Gmail and Google Calendar into a managed inbox and a managed day, surfaced as a ChatGPT-style sidebar of sessions inside your own Discord server. Every message shows you what it cost. Every outbound action waits for a tap. Built from the ground up to be 5–10x cheaper to run than naive agent loops — so a daily concierge costs pennies, not dollars.

## Product principles

1. **Opinionated tools, not a buffet.** Five tools, perfectly tuned.
2. **Stage-based reasoning, not freeform agent loops.** Every workflow is a fixed pipeline with hard token budgets per stage.
3. **The meter is the message.** Per-turn cost footer in every reply teaches users to start fresh sessions.
4. **Sessions are first-class.** Each forum post in your Discord server = one isolated context. New post = clean slate.
5. **Confirmation is a feature.** Outbound human-facing actions (send email, invite attendees) get Discord buttons. Self-only actions (create event on your own calendar) don't.

## The 5 tools

| Tool                    | Approval?                 |
|-------------------------|---------------------------|
| `read_email`            | no                        |
| `send_email`            | **yes** — Discord buttons |
| `read_calendar`         | no                        |
| `create_calendar_event` | no                        |
| `invite_attendees`      | **yes** — Discord buttons |

## Architecture: stage-based loop

```
Trigger ─▶ Classify ─▶ Gather ─▶ Reason ─▶ Act ─▶ Confirm? ─▶ Persist
 (cron,    (Haiku,    (bounded   (Sonnet,  (tool   (Discord    (SQLite
  webhook,  ~200tok)   fetches    ~2k tok   call)   button)     event log)
  forum                per type)  cap)
  post)
```

- Cheap models (Haiku 4.5 / Gemini Flash) route + summarize. Reasoning model (Sonnet 4.6) only at the Reason stage. Opus opt-in.
- Per-stage token caps enforced in code, not prompts.
- Every stage's tokens + cost get appended to the message footer.

## Per-message footer (every bot reply)

```
─────────────────────────────────
↑ 1,247 in  ↓ 312 out  ⏱ 2.1s
$0.0041 (sonnet-4.6)  •  session $0.018
```

## Discord-as-frontend

### Why Discord

We considered a custom web app and Telegram before landing on Discord. The deciding factors:

- **Already installed.** The target audience (power users, developers, OpenClaude users) already has Discord on their phone and desktop. No install friction, no new app to remember to open.
- **Background notifications.** Unlike a web app, Discord delivers push notifications even when the user isn't actively looking at it. This is essential for proactive pings (urgent emails, follow-up reminders, approval prompts).
- **Forum channels give us the ChatGPT-style sidebar for free.** Discord forum channels display posts as a browsable list — exactly the session sidebar familiar from ChatGPT and other LLM interfaces — without us building a custom frontend.

A custom web app was rejected because it requires the user to install a PWA and configure push permissions, which adds friction at exactly the moment (onboarding) where we can least afford it. Telegram was considered but Discord's forum-channel UX is a better fit for multi-session browsing.

### Session model

Each forum post in the `#robot-city` channel = one isolated conversation session. The context window for a session is scoped strictly to that thread — nothing from other threads leaks in.

**Why explicit isolation matters:** LLM cost scales with context length. The longer a conversation runs, the more tokens get re-sent with every new message (the full prior conversation is included each turn). Isolated sessions let users naturally reset the context when they switch topics. The per-message cost footer (see below) makes this cost visible, teaching the habit of opening a new post when starting something unrelated rather than continuing a long-running thread.

Users decide when a session is "done" — there is no auto-close. Starting a new forum post is the clear/reset action. Old posts remain readable but are not continued.

### Onboarding flow (`robot-city init`)

`robot-city init` automates the Discord setup so the user never touches the Discord developer portal:

1. Opens a browser to Discord OAuth — user grants the bot permission to create a server and manage channels.
2. Bot creates a personal Discord server from a template (or joins an existing server if the user prefers).
3. Bot creates a forum channel called `#robot-city` inside that server.
4. CLI confirms setup complete and prints the channel link.

After init, the user's entire interaction with robot-city happens inside Discord:

- **Conversations:** post in `#robot-city` to start a session; reply in the thread to continue it.
- **Proactive pings:** bot sends a DM to the user (morning brief, urgent email alert, follow-up due).
- **Approval prompts:** Discord button cards (Approve / Edit / Cancel) sent as DMs or in-thread for outbound actions.

Bot DMs are one-way notifications and confirmations only — they do not start new sessions or persist context.

## Cross-session memory

Static user profile only (timezone, name, key contacts, preferences) injected as ~150 tokens. No conversation memory across sessions. By design.

## Distribution

- npm package: `npx robot-city init` and `npx robot-city update`.
- Single-user per deploy.
- Default deploy target: Fly.io single Machine, ~$5/mo idle.

## Pricing tables (cost meter)

Anthropic + OpenAI + Google in v1, shipped as `pricing.json` keyed by `provider:model:tier`. Refreshed by a CI job that scrapes upstream pricing pages monthly, with a manual override path.

---

# Roadmap

See, docs/TODO.md for our current milestones as well as a list of outstanding features I still want built

---

# Tech stack

**Recommended (Option A): Bun + Hono + SQLite + Fly.io**

| Layer      | Choice                                                    |
|------------|-----------------------------------------------------------|
| Runtime    | Bun (native TS, `bun:sqlite`, fast cold start)            |
| HTTP       | Hono                                                      |
| DB         | SQLite on Fly persistent volume                           |
| Queue/cron | In-process worker + Fly Scheduled Machines                |
| Discord    | `discord.js`                                              |
| LLM router | Hand-rolled thin client per provider (no AI-SDK overhead) |
| Deploy     | Single Fly Machine, ~$5/mo idle                           |

## Key Decision Log

- **M1 Gmail trigger = polling, not push.** Pub/Sub deferred to M4. History-gone (404) is recovered by re-baselining + skipping the gap and logging `gmail:gap`.
- **Discord live bot ships in M1.** `discord.js` `Client` boots from `src/index.ts` whenever `DISCORD_BOT_TOKEN` is set. Pure handler logic lives in `src/discord/handlers.ts` so it can be tested without a gateway connection.
- **M2 interactive pipeline = classify → gather (code) → reason → act.** Gather is a pure TS function (no LLM cost) that fetches calendar/email data based on the classify label. Act outputs JSON and is dispatched by `src/stages/act_dispatcher.ts`.
- **M2 cron = in-process setInterval (60s tick).** Briefs fire when the current hour in the user's timezone matches the configured hour. State (fired-today set) is in memory; Fly Scheduled Machines deferred to M4+.
- **Google OAuth scope includes `calendar.events`.** Same OAuth client as Gmail; existing users must re-auth at `/auth/google` to get calendar access. Tokens stored in `gmail_tokens` table.
- **User settings are a generic KV table (`user_settings`).** Use `getSetting/setSetting` from `src/db/settings.ts`. Managed via `GET/PUT /settings` API; Discord/admin UI management deferred to M5.
- **M3 session UX:** running session $ in every footer; thread archive = session close (stats-only summary, no LLM); `runStage` accepts `string | Array<{role, content}>` so reason stage gets full thread history.
- **Deploy = Fly.io, one always-on Machine.** GH Actions (`.github/workflows/deploy.yml`) runs typecheck + tests, then `flyctl deploy --remote-only` on push to `main` or `workflow_dispatch`. `auto_stop_machines = "off"` because Gmail polling + cron scheduler are in-process `setInterval` loops. SQLite + vault state live on volume `robot_city_data` mounted at `/data` (`DB_PATH=/data/robot-city.db`). One-time setup (app create, volume create, secrets, `FLY_API_TOKEN` GH secret) documented in `docs/github-actions-fly-deploy-setup.md`.
- **Single fly app, no ephemeral PR envs.** Agents push PRs against `main`; CI (`pull_request` + `push`) runs typecheck + tests; deploy job is gated to `push`/`workflow_dispatch` so PRs never deploy. Rollback path: `flyctl releases rollback` for code, `cp /data/snapshots/robot-city.db.snapshot.<ts> /data/robot-city.db` + `flyctl machine restart` for data. `snapshotDb()` runs before `migrate()` on every boot and keeps the 5 most recent. Plan: `docs/local-dev-forum-scoping-and-db-snapshots.md`.
- **Forum scoping is env-driven.** `DISCORD_FORUM_NAME` (default `robot-city`) + optional `DISCORD_GUILD_ID` decide which forum the bot owns. `src/discord/forum.ts` resolves and caches the ID on boot; handlers filter by ID, not name, so local dev (`robot-city-dev`) and prod (`robot-city`) can coexist under one bot token in the same guild.
- **HTTP routes are owner-only by default.** All `/admin/*`, `/vault/*`, `/settings`, `/cron/*`, `/events`, `/stages/*`, `/gmail/poll`, and `/auth/logout` go through `requireOwner` + `csrf` middleware (`src/auth/middleware.ts`). Public carve-outs: `/health`, `/auth/*` (OAuth callbacks), `/login`, `/admin/static/*`. Login is Discord OAuth `identify` scope at `/auth/discord/login` — separate from the bot-install flow at `/auth/discord` (different scopes, different `DISCORD_LOGIN_REDIRECT_URI`). Owner identity = `OWNER_DISCORD_ID` env var. Sessions live in `admin_sessions` SQLite table; cookie is HttpOnly+Secure+SameSite=Lax, CSRF via double-submit token (`X-CSRF-Token` header vs `rc_csrf` cookie). Design: `docs/admin-dashboard-and-auth-design.md`.