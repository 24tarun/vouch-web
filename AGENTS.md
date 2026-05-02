# AGENTS.md

## Source of Truth

- `SYSTEM_SPEC.md` is the implementation authority for schema, RLS, transitions, jobs, and edge cases.
- This file is the operating guide for agents plus a concise product contract.
- If this file conflicts with runtime behavior or DB constraints, follow `SYSTEM_SPEC.md` and current code.
- Read `SYSTEM_SPEC.md` selectively: identify the task first, then read only the relevant sections (plus adjacent constraints) instead of scanning the entire file.
- Typical selective-read mapping:
  - Schema/RLS/migrations work: Section 3 (+ Section 10 coverage rows as needed)
  - Lifecycle/transition logic: Section 5
  - Routes/server actions: Section 6
  - Background jobs/scheduling: Section 7
  - Realtime/cache consistency: Section 8
  - Edge-case validation: Section 9
  - Unknown/ambiguous behavior checks: Section 11

## Engineering Guardrails

- Server actions in `src/actions/` are the write boundary. Keep business logic out of route handlers.
- All DB access must use Supabase clients from `src/lib/supabase/`; do not use raw SQL from client code.
- XState in `src/lib/xstate/task-machine.ts` is advisory only; real transitions are enforced in server actions and DB rules.
- Background jobs must use the admin Supabase client (`createAdminClient`).
- RLS is always on; verify access control with user-scoped clients, not admin clients.
- `src/lib/types.ts` is the TS shape baseline, but verify uncertain fields against `SYSTEM_SPEC.md` and migrations.

## Test Standards

Every new or modified test must include inline comments that cover:
1. What and why the test checks.
2. A passing scenario.
3. A failing scenario.

## Product Contract (Extracted)

### Product Intent

TAS is an accountability system where users create commitments with financial downside and social verification.
UI is implementation-flexible; backend behavior must match `SYSTEM_SPEC.md`.

### Actors

- Owner: creates tasks, does work, bears failure cost.
- Voucher: reviews completions, accepts/denies, requests proof, can authorize rectify, can soft-delete assigned non-final tasks.
- System: enforces deadlines/timeouts, reminders, recurrence generation, proof cleanup, settlement emails, and calendar sync jobs.

### Core Outcomes

- Increase completion through explicit downside.
- Preserve auditability via `task_events` and `ledger_entries`.
- Keep voucher workflow lightweight.
- Allow constrained safety valves: rectify passes and force majeure.

### Core Objects

- Tasks, Friendships, Ledger Entries, Rectify Passes, Force Majeure, Recurrence Rules, Reminders, Completion Proofs, Pomodoro Sessions, Profile Defaults, Event Tasks, Google Calendar Connections.

### Lifecycle and Financial Invariants

- Canonical lifecycle: `CREATED -> POSTPONED -> AWAITING_VOUCHER -> COMPLETED/FAILED -> RECTIFIED/SETTLED/DELETED` (runtime nuances in `SYSTEM_SPEC.md`).
- Self-vouch completion skips voucher queue and transitions directly to `COMPLETED`.
- Voucher timeout auto-accepts task and applies a voucher penalty of 30 cents.
- Owner hard delete is allowed only for active tasks within 10 minutes of creation.
- `deadline` is the effective due-time for all tasks; `google_event_end_at` is legacy mirrored sync metadata.
- Failure costs are cents-based; failures add ledger entries, rectify/force-majeure write negative offsets.
- Supported currencies: `EUR`, `USD`, `INR`.
- DB hard bounds for failure cost: `1..100000` cents.

### Limits and Time Windows

- Postpone allowed once per task.
- Rectify passes: 5 per owner per month.
- Force majeure: 1 per owner per month.
- Rectify window: 7 days from failure timestamp basis (`tasks.updated_at`).
- Voucher response deadline: approximately end-of-day local time around +2 days from completion mark.
- Default event duration: `1..720` minutes.
- Google event color IDs: `'1'..'11'`.

### Key Flow Requirements

- Task creation validates auth, voucher relation, currency/deadline/reminder bounds, then writes task + dependent entities + `CREATED` event.
- Completion/review flow enforces subtasks and pomodoro requirements before voucher review path.
- Failure path runs via scheduled jobs and may also trigger on overdue detail-read safeguards.
- Recurrence generator creates future tasks in rule timezone, carries/seeds reminders, and enqueues calendar sync for event rules.
- Reminder flow supports manual reminders and seeded deadline warnings.
- Proof flow keeps media private/temporary and cleans artifacts on terminal transitions, expiry, or staleness.

### Google Calendar Contract

- OAuth connection with encrypted token storage.
- Directional sync controls are independent: app->Google and Google->app.
- Outbox dispatch handles app->Google mutation propagation.
- Webhook-triggered delta sync handles Google->app updates.
- `Disconnect & Forget` revokes access and purges integration rows without deleting existing tasks.
- Sweeper retries pending outbox work and reconciles stale connections; watch renewals run periodically.

### Parser Autocomplete Contract (Client UX)

- Inline ghost-text autocomplete supports recognized parser keywords/tokens.
- `vouch` / `.v` supports friend username prefix completion; built-in self aliases are excluded from friend suggestions.
- Autocomplete is suppressed when caret is not at end, color picker is active, or input is unfocused.

### Non-Functional Requirements

- Consistency: DB writes are strong; UI sync is eventually consistent via realtime + refresh/revalidation.
- Security: Supabase Auth + RLS + server-side guards are mandatory.
- Auditability: major transitions must be event/ledger backed.
- Payment execution is out of scope for this repo.
