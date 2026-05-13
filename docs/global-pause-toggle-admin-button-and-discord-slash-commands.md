# Global pause toggle: admin button + Discord `/pause` `/resume`

## Goal

A single switch that suspends every recurring/automated LLM-billing path while
keeping the server running. When paused:

1. Cron briefs (morning / midday / evening) do not fire.
2. The Gmail triage tick (`runTriageTick`, called by `/gmail/poll`) no-ops.
3. Forum thread messages get a short non-LLM reply explaining the bot is paused.

Two ways to toggle:

- **Admin dashboard:** a toggle button under `/admin/actions` (the existing
  manual-trigger page).
- **Discord:** guild slash commands `/pause` and `/resume`, owner-only.

## State

A single setting in the existing `user_settings` KV: key `paused`, value
`'true'` or `'false'`. Default `'false'`. Wrapped by `src/system/pause.ts`:

```ts
isPaused(): boolean
setPaused(value: boolean, source: 'admin' | 'discord'): void
```

`setPaused` logs `[pause] <source> -> paused=<bool>` to stdout so we have a
breadcrumb without polluting the events table.

## Gates

| File | Where | Behavior when paused |
|---|---|---|
| `src/cron/scheduler.ts` | top of `setInterval` callback | `return` before the brief loop |
| `src/gmail/triage_loop.ts` | top of `runTriageTick` | return `{ pollKind: 'baselined', triaged: 0, notified: 0, approvalsRequested: 0 }` |
| `src/discord/handlers.ts` | top of `handleThreadMessage` | `sendThreadMessage(threadId, "🛑 Paused. Re-enable from /admin/actions or with /resume.")` and return |

DB backups are intentionally left running — they're not LLM-billing.

## Discord slash commands

- New `src/discord/slash_commands.ts`:
  - `registerGuildSlashCommands(applicationId, guildId)`:
    `PUT /applications/{id}/guilds/{guildId}/commands` with bot auth,
    body `[{name:'pause',description:...}, {name:'resume',description:...}]`.
  - `handleSlashCommand({ name, userId }): { content: string; ephemeral: true }`
    — owner check via `OWNER_DISCORD_ID`, toggles state, returns confirmation.
- `src/discord/bot.ts`:
  - On `Events.ClientReady`, call `registerGuildSlashCommands` against the
    resolved forum's guild.
  - In `Events.InteractionCreate`, add `if (interaction.isChatInputCommand())`
    branch that dispatches to `handleSlashCommand` and replies ephemerally.
- `src/discord/oauth.ts:17`: scope `'identify guilds bot'` →
  `'identify guilds bot applications.commands'`. **Re-run `/auth/discord`
  once** so the bot is re-added to the guild with command visibility.

Guild commands are used (not global) because they propagate instantly and the
app is single-guild by design.

## Admin UI

`src/admin/actions.tsx`:

- Add a third `<section className="action">` "Pause assistant".
- Renders the current state from `isPaused()`.
- Button posts to `/admin/actions/pause-toggle`. Server flips the flag and
  returns the updated section via `hx-swap="outerHTML"`.
- Button label/color flips between "Pause assistant" (`btn-danger`) and
  "Resume assistant" (`btn-primary`).

## Tests

`tests/pause.test.ts`:

1. `setPaused(true)` then `isPaused()` returns `true`; round-trip survives via
   `getSetting`.
2. `runTriageTick` early-returns with zero counts when paused, and does not
   call `fetch` (verified through `installFetchMock`).

## Out of scope / decisions

- No header indicator badge — user picked actions-page-only.
- No new slash-command infrastructure beyond `/pause` and `/resume`.
- No paused-state UI in the forum reply beyond a one-line text message
  (no embedded button) — slash commands are the resume path.
- Approval-card buttons remain functional while paused; they don't bill new
  LLM tokens, they just execute a pending tool call.
