# M2 Daily Concierge — Implementation Notes

## What was built

Google Calendar integration, daily brief crons, two new tools (`create_calendar_event`, `invite_attendees`), and a wired `act` stage dispatcher so Discord thread messages can trigger tool calls.

## Architecture changes

### Full interactive pipeline (handlers.ts)
Discord thread messages now run a 4-step pipeline instead of the old 2-step:
1. **Classify** (Haiku) — intent label: `READ_CALENDAR`, `CREATE_CALENDAR_EVENT`, `INVITE_ATTENDEES`, `READ_EMAIL`, `SEND_EMAIL`, `CONVERSATION`
2. **Gather** (code-only, no LLM) — fetches calendar events or recent email triage data from DB based on classify label
3. **Reason** (Sonnet) — composes the user-facing response using gathered context
4. **Act** (Haiku) — outputs JSON tool call or `{"tool":"none"}`, dispatched by `act_dispatcher.ts`

Footer now sums cost across all 3 LLM stages.

### Gather stage (src/stages/gather.ts)
Pure code step — no LLM token cost. Detects intent from classify output and fetches data:
- `READ_CALENDAR` / `CREATE_CALENDAR_EVENT` / `INVITE_ATTENDEES` → calls `listEvents` for today
- `READ_EMAIL` → queries recent `workflow:triage` events from SQLite (no extra API call)

### Act dispatcher (src/stages/act_dispatcher.ts)
Parses act JSON, routes to tool. Approval tools (`invite_attendees`, `send_email`) create a pending approval and DM the card immediately.

## New files

| File | Purpose |
|------|---------|
| `src/calendar/client.ts` | Google Calendar REST (listEvents, createEvent, patchAttendees) |
| `src/tools/read_calendar.ts` | Format calendar events as text context |
| `src/tools/create_calendar_event.ts` | Create event, no approval |
| `src/tools/invite_attendees.ts` | Add attendees to event, approval-gated |
| `src/stages/gather.ts` | Code-only data fetcher keyed to classify intent |
| `src/stages/act_dispatcher.ts` | Parse act JSON, call tools |
| `src/workflows/morning_brief.ts` | Generate morning/midday/evening brief, send DM |
| `src/cron/scheduler.ts` | setInterval (60s tick) cron for daily briefs |
| `src/db/settings.ts` | getSetting / setSetting / getAllSettings helpers |

## OAuth note

The Google OAuth scope now includes `calendar.events`. Existing users must re-authenticate at `/auth/google` to get calendar access.

## Settings (user_settings table)

| Key | Default | Meaning |
|-----|---------|---------|
| `brief_morning_enabled` | `true` | Fire morning brief |
| `brief_morning_hour` | `8` | Hour to fire (0–23, in user's timezone) |
| `brief_midday_enabled` | `false` | Fire midday brief |
| `brief_midday_hour` | `12` | — |
| `brief_evening_enabled` | `false` | Fire evening brief |
| `brief_evening_hour` | `18` | — |
| `timezone` | `UTC` | IANA timezone for cron scheduling |

## New API endpoints

```
GET  /settings           → all key/value pairs
PUT  /settings/:key      → {"value": "..."} to update
POST /cron/brief         → {"label": "morning"|"midday"|"evening"} trigger brief manually
```
