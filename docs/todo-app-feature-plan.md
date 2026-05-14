# Todo App Feature Plan

## Overview
Add a lightweight todo management feature to robot-city. This integrates with the existing admin dashboard and optionally exposes todos as context to the LLM for proactive mentions (e.g., "You have 3 overdue items").

## Scope (MVP)

### Database Schema
- New table: `todos` with columns:
  - `id` (primary key)
  - `title` (text)
  - `description` (text, nullable)
  - `completed` (boolean, default false)
  - `due_date` (timestamp, nullable)
  - `priority` (enum: low/medium/high, default medium)
  - `created_at` (timestamp)
  - `updated_at` (timestamp)

### Admin UI
- New page at `/admin/todos` (read/write access)
- Mobile-first table/list view showing:
  - Title, due date, priority, completed status
  - Quick toggle to mark complete/incomplete
  - Delete button with confirmation
  - Modal to add/edit todos
- Responsive grid on mobile (≤640px), table on desktop

### API Endpoints
- `GET /todos` — list all todos
- `POST /todos` — create new todo
- `PATCH /todos/:id` — update todo
- `DELETE /todos/:id` — delete todo

### Optional: LLM Integration
- Include user's overdue/high-priority todos in the static profile passed to classify/reason stages
- E.g., append 3–5 incomplete items to system prompt for proactive mentions
- Token cap: ~150 tokens (fits within existing static profile budget)

## Architecture Decisions

1. **No approval gating** — todos are self-only (no outbound action)
2. **No Discord integration in MVP** — admin UI only for simplicity
3. **No notifications** — todos are passively read, not proactively pushed
4. **Simple priority/dates** — no complex scheduling, labels, or recurring todos

## Files to Create/Modify

### New files:
- `src/db/todos.ts` — schema + helpers (`getTodos`, `createTodo`, `updateTodo`, `deleteTodo`)
- `src/admin/pages/todos.tsx` — page component (React SSR)
- `src/admin/handlers/todos.ts` — route handlers for CRUD

### Modify:
- `src/db/schema.ts` — add todos table migration
- `src/admin/router.ts` — register `/admin/todos` routes
- `src/admin/pages/layout.tsx` — add "Todos" nav link (if using sidebar nav)

## Testing
- Unit: CRUD operations in `tests/db.todos.test.ts`
- Integration: API routes in `tests/admin.todos.test.ts`
- Manual: Add/edit/delete a few todos from `/admin/todos`, verify UI + DB state

## Rollout
1. Implement schema + DB helpers
2. Add admin UI (page + forms)
3. Wire up routes
4. (Optional follow-up) Integrate into LLM system prompt for proactive mentions

## Effort
~4–6 hours (schema, 2 page components, CRUD endpoints, basic tests)
