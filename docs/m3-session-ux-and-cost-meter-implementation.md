# M3 Session UX & Cost Meter — Implementation Notes

## What was built

Session-aware cost accounting, multi-turn thread history feeding the reason stage, and a session-summary post when a Discord thread is archived.

## Architecture changes

### Session cost accumulator (src/db/sessions.ts — new)
- `ensureSession(sessionId)` — `INSERT OR IGNORE`; extracts `discord_thread_id` automatically when `sessionId` starts with `discord:`.
- `bumpSessionCost(sessionId, costUsd)` — `UPDATE sessions SET total_cost_usd = total_cost_usd + ?`. Called by `runStage` after every LLM call.
- `getSessionCost(sessionId)` — used by `handleThreadMessage` to feed `buildFooter` so every bot reply shows running session total.
- `computeSessionStats(sessionId)` — SQL aggregates from the events table: `SUM(input_tokens)`, `SUM(output_tokens)`, `COUNT(stage:reason)` (= user turns), `COUNT(tool:%)`.
- `markSessionClosed(sessionId)` — idempotent close (`closed_at IS NULL` guard in the UPDATE).

### `runStage` now accepts a messages array
Signature widened: `input: string | Array<{role, content}>`. Strings still get wrapped as a single user message; arrays pass through to the LLM. This unlocks multi-turn conversations without growing the API.

### Thread history → reason stage (src/discord/history.ts — new)
`fetchThreadHistory(threadId, beforeMessageId?, limit=20)` calls Discord `GET /channels/:id/messages?limit=N&before=...`, reverses to chronological order, maps `author.bot` to `role: 'assistant'`/`'user'`, and **strips footers** from assistant messages by cutting at `─────────────────────────────────`. Empty content after stripping is dropped.

`handleThreadMessage` now requires `messageId` (passed by `bot.ts` as `msg.id`) so the history fetch can use `before=` to exclude the current message. Reason stage receives the full history + a synthetic latest user turn containing `[CURRENT DATE]`, `[ORIGINAL MESSAGE]`, `[CLASSIFY]`, and `[CONTEXT]` sections.

### Session close on thread archive (src/discord/bot.ts, handlers.ts)
`Events.ThreadUpdate` listener fires `handleThreadArchive` when `oldThread.archived === false && newThread.archived === true` and the parent forum is `robot-city`. The handler:
1. Reads session stats from the events table — **no LLM call**.
2. Posts a summary in the thread: total $, message count, tool count, token totals.
3. Sets `sessions.closed_at`.
4. Idempotent — re-archiving a closed session does nothing.

## New files

| File | Purpose |
|------|---------|
| `src/db/sessions.ts` | Session row helpers: ensure, bump cost, link Discord thread, compute stats, mark closed |
| `src/discord/history.ts` | Fetch Discord thread history → `[{role, content}]` with footer stripping |

## Modified files

| File | Change |
|------|--------|
| `src/stages/runner.ts` | `runStage` accepts messages array; bumps session cost; uses `ensureSession` (which sets `discord_thread_id`) |
| `src/discord/handlers.ts` | `handleThreadMessage` adds `messageId` param, fetches history, includes session $ in footer; new `handleThreadArchive` |
| `src/discord/bot.ts` | Passes `msg.id`; new `Events.ThreadUpdate` listener for archive transitions |

## Footer format (per the SPEC example)

```
─────────────────────────────────
↑ 1,247 in  ↓ 312 out  ⏱ 2.1s
$0.0041 (claude-sonnet-4-6)  •  session $0.0182
```

`buildFooter` signature is unchanged — `sessionCostUsd` is optional, so non-Discord callers (e.g., `runPipeline` HTTP endpoint) keep getting the short footer.

## Session-close message format

```
**Session closed**
─────────────────────────────────
$0.0210 total  •  2 messages  •  1 tool call
↑ 645 in  ↓ 200 out
```

## Tests

| File | Coverage |
|------|----------|
| `tests/stages/session_cost.test.ts` | accumulation, `discord_thread_id` linkage, `buildFooter` session segment, `getSessionCost` |
| `tests/discord/thread_history.test.ts` | API call shape, chronological order, role assignment, footer stripping, `before=` exclusion, empty thread |
| `tests/discord/session_close.test.ts` | stats summary content, `closed_at` set, idempotent, no-op when session row missing |
| `tests/discord/handlers.test.ts` (extended) | footer includes `session $X`, reason stage gets multi-turn history with stripped footers, `before=<msgId>` used |
