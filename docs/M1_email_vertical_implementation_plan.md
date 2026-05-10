# M1 — Email Vertical: Implementation Plan

> Scope per `SPEC.md` Roadmap: Gmail OAuth + push (polling for v1), `inbox.triage` workflow, `send_email` with Discord button confirm. Drives Classify → Gather → Reason → Act → **Confirm** → Persist end-to-end for the email vertical.

## Decisions

- **Trigger:** Polling (cron-driven history.list watermark per user). Push receiver deferred to M4. On Gmail 404 from `users.history.list` (watermark older than ~7d, the documented retention window), fall back to a fresh sync from the latest `historyId` and skip ahead — we drop the gap rather than re-process every message.
- **Discord runtime:** Live `discord.js` gateway client. Forum thread posts drive the pipeline; DMs deliver approval cards.
- **No new abstractions.** Gmail client is a hand-rolled fetch wrapper, mirroring the provider clients. Approval state lives in SQLite, not a queue.
- **Test runner:** `bun test`. Fetch is mocked at the global level; no live network in unit tests.

## Slices (each a Red→Green pass)

1. **Test infrastructure** — wire `bun test`, add a `tests/_helpers/fetch-mock.ts` so tests can stub Gmail/Discord/LLM HTTP without a transport library.
2. **Gmail OAuth** — `getGmailAuthUrl`, `exchangeGmailCode`, `refreshGmailAccessToken`. Store tokens in a new `gmail_tokens` table.
3. **Gmail client** — `listHistory(historyId)`, `getMessage(id)`, `sendMessage({to, subject, body})`. `listHistory` raises `GmailHistoryGoneError` on 404 so the poller can recover.
4. **History watermark + poll loop** — `pollGmail(userId)` reads watermark, calls `listHistory`, yields new message IDs, advances watermark. On `GmailHistoryGoneError` it re-baselines from `users.getProfile().historyId` (skipping the gap) and records a `gmail:gap` event.
5. **`inbox.triage` workflow** — for each new message: gather (subject + snippet + from), classify (`ignore` | `respond` | `urgent`), reason (one-paragraph plan + optional draft). Persists a triage event per message; emits a Discord notification only for `respond` / `urgent`.
6. **Approval state machine** — `pending_approvals` table. `createApproval(action, payload, expiresAt)` → `pending`. `approve(id)` / `reject(id)` / `expire(id)` are the only transitions. Approved actions are dispatched to a typed handler (initially only `send_email`).
7. **`send_email` tool** — accepts `{to, subject, body}`, creates a `pending_approval`, returns the approval id. Approved approvals call `sendMessage` and log a `tool:send_email` event. Rejected approvals log and discard.
8. **Discord runtime** — discord.js `Client` with `Guilds`, `GuildMessages`, `MessageContent`, `DirectMessages` intents. Listens for messages in `#robot-city` forum threads, runs the pipeline, replies in thread with the cost footer. Approval cards (Approve/Edit/Cancel buttons) DMed to the user; button interactions resolve the approval and update the card.

## Out of scope for M1

- Push subscription wiring (M4).
- Editing the draft inline before sending (M2 stretch — for M1, "Edit" reopens the thread with the draft as a message; "Cancel" rejects).
- Calendar tools (M2).
- Cost/session UX polish (M3) — footer already exists; no per-session totals yet.

## Test plan

| Slice | Key tests |
|---|---|
| Test infra | fetch-mock asserts URL+body, returns canned response |
| OAuth | URL builder, code→tokens, refresh on 401, token persistence round-trip |
| Gmail client | sendMessage builds RFC 822 + base64url; listHistory throws on 404; getMessage parses payload |
| Poll loop | advances watermark on success; re-baselines + emits gap event on 404; idempotent re-runs |
| Triage | maps classify label → action; skips `ignore`; writes triage event |
| Approval | state transitions reject invalid moves; expiry is a transition not a delete |
| send_email | creates approval, does NOT call Gmail until approve(); reject discards |
| Discord runtime | thin handler test: thread message → runPipeline call; button → approve/reject |
