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

