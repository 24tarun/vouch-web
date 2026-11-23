# Vouch agent API

## MCP server (recommended for AI apps)
`POST /api/mcp` — stateless MCP over Streamable HTTP, same API key in `Authorization: Bearer vouch_…`.

Tools: list_tasks, get_task, create_task, postpone_task, complete_task, add_subtask, set_subtask_done,
set_reminders, get_calendar, create_time_block, move_time_block, delete_time_block, plus
list_actions / call_action for every other app action.

Claude Code:
`claude mcp add --transport http vouch https://<your-domain>/api/mcp --header "Authorization: Bearer vouch_…"`

The HTTP endpoints below expose the same things for agents that don't speak MCP.


Auth: `Authorization: Bearer vouch_…` — create the key in Settings → API key. It acts as your account only.
All times are ISO 8601 with a timezone. Errors are `{ "error": "…" }` with a 4xx status; read them back as-is.

## Read
`GET /api/integrations/calendar?from=…&to=…` (both optional; default now → +7 days; max 15 days)

Returns `timezone` (speak times in this zone) plus:
- `deadlines` — tasks due in the range: `task_id, title, status, deadline, open, is_event, repeating`
- `upcoming_repeats` — repeats not created yet: `rule_id, title, deadline`
- `blocks` — planned time: `id, title, status, start_at, end_at, task_id | rule_id + occurrence_deadline`
- `plannable` — what a new block can attach to: `task_id` or `rule_id + occurrence_deadline`, with `title, deadline`

## Write (time blocks)
- Create: `POST /api/integrations/calendar/blocks` `{ "task_id": "…", "start_at": "…", "end_at": "…" }`
  or for a repeat not created yet: `{ "rule_id": "…", "occurrence_deadline": "…", "start_at": "…", "end_at": "…" }`
  (copy the ids from `plannable`).
- Move / resize: `PATCH /api/integrations/calendar/blocks/:id` `{ "start_at": "…", "end_at": "…" }`
- Delete: `DELETE /api/integrations/calendar/blocks/:id`

Rules (enforced server-side): blocks only for open (active/postponed) non-event tasks, must end by the task deadline,
start and end on 15-minute steps (:00/:15/:30/:45), at most 24 hours long. A block on an upcoming repeat moves onto the real task once it is created.

Postponing a deadline: use the `postponeTask` action below.

## Everything else: app actions
Any app action can be run as the key's owner, with the same checks as the app UI.

- List them: `GET /api/integrations/actions` → `{ actions: [{ name, params }] }`
- Run one: `POST /api/integrations/actions/:name` `{ "args": [ ...positional arguments ] }` → `{ result }`

Examples:
- `postponeTask` `{ "args": ["<task_id>", "2026-11-24T21:00:00+01:00"] }`
- `getTask` `{ "args": ["<task_id>"] }`
- `markTaskComplete` `{ "args": ["<task_id>", "Europe/Berlin"] }`
- `addTaskSubtask` `{ "args": ["<task_id>", "buy milk"] }`

Actions that take a form (e.g. `createTask`, `updateUserDefaults`, `addFriend`) take
`{ "$formData": { "field": "value" } }` in place of the form argument.
Results are whatever the action returns; most return `{ error }` on failure, so check for it.

Never available with a key: sign in/out, sign up, password reset, account deletion, Google connect.
