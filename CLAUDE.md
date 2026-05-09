# robot-city — agent guide

> Operational notes for coding agents. The product spec lives in `docs/SPEC.md`; read it once if you need product context. This file is for **how to work in the repo without re-exploring it every session**.

## What this is, in one breath

Self-hosted single-user AI life concierge (Gmail + Calendar) fronted by a Discord forum channel. Built around a fixed **Classify → Gather → Reason → Act → Confirm → Persist** pipeline with hard token caps per stage. Cost-per-message is a first-class UX element.

## Stack at a glance

- **Runtime:** Bun (uses `bun:sqlite`, native TS — no `ts-node`, no `tsc` build step at runtime)
- **HTTP:** Hono
- **DB:** SQLite via `bun:sqlite` (file at `data/robot-city.db`)
- **Discord:** `discord.js` v14
- **LLM clients:** hand-rolled per provider in `src/providers/` — **do not introduce `ai`, `@ai-sdk/*`, LangChain, or similar**
- **Deploy target:** Fly.io single Machine

## Repo map

```
src/
  index.ts              # Hono entrypoint
  cli/init.ts           # `robot-city init` Discord auto-setup
  discord/              # OAuth + server/channel bootstrap
  providers/            # router.ts + per-provider clients (anthropic, openai, google)
  stages/               # runner.ts (the pipeline) + types.ts
  db/                   # schema.ts + client.ts (bun:sqlite)
  vault/                # encrypted BYOK key storage
data/                   # SQLite files (gitignored)
pricing.json            # provider:model:tier → $/1M tokens, refreshed monthly
SPEC.md                 # product spec — source of truth for *what* to build
```

## Commands

| Task               | Command             |
|--------------------|---------------------|
| Dev server (watch) | `bun run dev`       |
| Start              | `bun run start`     |
| Typecheck          | `bun run typecheck` |
| Init Discord       | `bun run init`      |

There is no test runner wired up yet. If you add one, prefer `bun test`.

## Conventions that aren't obvious from the code

- **Token caps live in code, not prompts.** See `STAGE_DEFAULTS` in `src/stages/runner.ts`. If a stage overruns, fix the cap or the input — don't add "be brief" to the prompt.
- **Models per stage are deliberate:** Haiku for classify/gather/act, Sonnet for reason. Opus is opt-in only. Don't silently upgrade.
- **Every LLM call must go through `callLLM` in `src/providers/router.ts`** so it lands in the SQLite event log with tokens + cost. No direct provider SDK calls from feature code.
- **Sessions are forum threads.** No cross-session conversation memory. Static profile (≤150 tok) is the only thing that crosses sessions — by design.
- **Approval gating:** outbound human-facing tools (`send_email`, `invite_attendees`) require Discord button confirm. Self-only tools don't. If you add a tool, decide which bucket it's in.
- **The 5 tools are the product.** Don't add tools casually — `SPEC.md` §"The 5 tools" is the contract.

## Things to NOT do

- Don't add an agent framework or LLM abstraction layer.
- Don't add a vector DB or long-term memory across sessions.
- Don't introduce build steps (Webpack/Vite/tsc emit). Bun runs TS directly.
- Don't hardcode prices — read `pricing.json`.
- Don't log secrets or full email bodies to the event log; redact at the boundary.

## Key Decision Log


## Personal preferences for working in this repo
When you are planning out changes with a harnesses "plan mode", make sure to write out your finalized plan ONCE APPROVED to docs/ directory. The .md file name can be long and descriptive I should be able to immedietly tell what the file was used for by the title of it.

---

## Self-update protocol (for the agent)

After finishing a task, ask yourself: **did I learn something a future session would have to re-discover?** If yes, update this file before signing off. Specifically:

- New top-level directory or significant module → update **Repo map**.
- Added/removed a script in `package.json` → update **Commands**.
- Made or surfaced an architectural decision (e.g., chose a library, ruled one out) → add a line to **Conventions** or **Things to NOT do**.

Keep this file tight. If a section grows past ~15 lines, it probably belongs in `SPEC.md` or its own doc. **Prune as aggressively as you add.** Stale guidance is worse than no guidance.
