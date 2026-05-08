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

| Tool | Approval? |
|---|---|
| `read_email` | no |
| `send_email` | **yes** — Discord buttons |
| `read_calendar` | no |
| `create_calendar_event` | no |
| `invite_attendees` | **yes** — Discord buttons |

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

- CLI's `robot-city init` walks the user through:
  1. Create personal Discord server (template link)
  2. Invite bot via OAuth
  3. Bot auto-creates a forum channel called `#robot-city`
- Each forum post = a session. Sidebar of posts = sidebar of sessions.
- Bot DMs the user only for proactive pings + approval prompts.

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

| Milestone | Scope | Est. |
|---|---|---|
| **M0 Foundation** | Bun + Hono scaffold, Discord OAuth, encrypted BYOK vault, provider router (Anthropic + OpenAI + Google), stage-runner with hard token caps, SQLite event log | 1–2 wk |
| **M1 Email vertical** | Gmail OAuth + push, `inbox.triage` workflow, `send_email` w/ Discord button confirm | 2–3 wk |
| **M2 Daily concierge** | Google Calendar, morning/midday/evening briefs (cron), `create_calendar_event`, `invite_attendees` w/ confirm | 2–3 wk |
| **M3 Session UX & cost meter** | Forum-channel session model, per-message cost footer, model price table, session summary on close, `robot-city init` Discord auto-setup | 1–2 wk |
| **M4 Event-driven proactivity** | Urgency classifier on inbound mail, calendar-conflict watcher, follow-up tracker, quiet hours | 1–2 wk |
| **M5 Admin dashboard** | Token + cost charts by workflow / day, approval history, tool call audit. Single Hono-served SPA | 1 wk |
| **M6 Distribution polish** | `npx robot-city` installer, auto-update channel, docs site | 1–2 wk |

**v2 backlog:** trust tiers for `send_email`, Notion brain, Obsidian adapter, browser extension capture, voice in/out, multi-tenant.

---

# Tech stack

**Recommended (Option A): Bun + Hono + SQLite + Fly.io**

| Layer | Choice |
|---|---|
| Runtime | Bun (native TS, `bun:sqlite`, fast cold start) |
| HTTP | Hono |
| DB | SQLite on Fly persistent volume |
| Queue/cron | In-process worker + Fly Scheduled Machines |
| Discord | `discord.js` |
| LLM router | Hand-rolled thin client per provider (no AI-SDK overhead) |
| Deploy | Single Fly Machine, ~$5/mo idle |

**Option B: Bun + Hono + Postgres + Redis** (Neon + Upstash, BullMQ, pgvector). More familiar ops, easier to grow into multi-tenant later. ~$20–40/mo idle.

**Option C: Cloudflare Workers + D1 + Durable Objects.** $0 idle, zero servers, but 30s CPU per request constrains long stage chains; needs careful chunking.
