# Vouch â€” Codebase Context

> **Keep this file up to date.** After any significant feature addition or refactor, update the relevant section.
> Full specs live alongside this file: `PRD.md` (product) and `SYSTEM_SPEC.md` (implementation contracts).

---

## 1. What Is Vouch?

Vouch is a **task accountability web app**. Users create tasks with:
- A **deadline**
- A **failure cost** (in EUR/USD/INR, stored in cents) â€” charged to a charity if the task is missed
- A **voucher** â€” a friend (or themselves) who approves/denies completion claims

The core loop: commit to something, get a friend to vouch for it, complete it before the deadline, let the voucher confirm it. Miss it â†’ pay up.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 App Router (Server Components + Server Actions) |
| Database / Auth / Storage / Realtime | Supabase (Postgres + RLS + Storage bucket `task-proofs` + Realtime) |
| Background Jobs | Trigger.dev v3 (cron + event-triggered) |
| Email | Resend |
| Push Notifications | Web Push (VAPID) |
| State Machine | XState v5 (advisory only â€” DB writes happen in server actions) |
| Confetti | `canvas-confetti` via `src/lib/confetti.ts` â€” `fireCompletionConfetti()` fired on task completion from both dashboard and task detail |
| Calendar Integration | Google Calendar API (bidirectional OAuth sync) |
| Hosting | Vercel |
| Mobile | Capacitor (iOS/Android â€” wrappers over the web app) |

---

## 3. Project Structure

```
src/
  actions/          # Server actions (all business logic write paths)
    auth.ts         # Sign-in/out, account deletion, profile updates
    commitments.ts  # Commitment CRUD/linking/reads + failure notification helper
    friends.ts      # Add/remove friends, friend activity
    google-calendar.ts  # OAuth connect/disconnect, calendar selection
    ledger.ts       # Read ledger entries
    push.ts         # Push subscription management
    reputation.ts   # getUserReputationScore()
    tasks.ts        # All task CRUD + lifecycle transitions (~1850 lines)
    voucher.ts      # Voucher accept/deny/rectify/delete/proof-request
  app/
    dashboard/      # All authenticated pages
      commitments/         # Commitment list/create/detail
      page.tsx              # Main task list
      tasks/[id]/           # Task detail
      tasks/new/            # Task creation form
      voucher/              # Voucher review queue
      friends/              # Friend activity
      ledger/               # Monthly ledger
      stats/                # Task history/stats
      settings/             # User settings + Google Calendar
    api/
      integrations/google/  # OAuth callback + webhook
      pomo/auto-end/        # Internal pomo auto-end
      task-proofs/[taskId]/ # Proof media serving (signed URL)
    login/          # Auth page
  components/       # Shared UI components
    CommitmentCard.tsx
    CommitmentCreatorClient.tsx
    CommitmentDetailClient.tsx
    CommitmentsPageClient.tsx
    DotGrid.tsx
    TaskPickerModal.tsx
    ReputationBar.tsx
    TaskInput.tsx
    TaskRow.tsx
    PomodoroTimer.tsx
    RealtimeListener.tsx
    ...
  lib/
    commitment-status.ts # Pure derived status / counters / day-status grid
    reputation/
      algorithm.ts  # Full scoring engine
      constants.ts  # All weights, multipliers, thresholds
      types.ts      # ReputationTaskInput, CategoryScores, ReputationScoreData
    xstate/
      task-machine.ts  # Task lifecycle state machine (advisory)
    supabase/
      client.ts / server.ts / admin.ts / session.ts
    types.ts        # All DB TypeScript types
    task-title-parser.ts   # Parses -event, -start, -end, -color, pomo, vouch tokens
    constants.ts    # App-level bounds, windows, defaults
    ...
  trigger/          # Background jobs (Trigger.dev)
    deadline-fail.ts        # Every 5 min â€” fail overdue tasks
    voucher-timeout.ts      # Hourly â€” auto-accept + penalize voucher
    recurrence-generator.ts # Scheduled â€” generate next recurring task
    ledger-settlement.ts    # Monthly â€” send settlement emails
    task-reminder-notify.ts # Every 1 min â€” push/email reminders
    task-proof-cleanup.ts   # Periodic â€” purge stuck/stale proofs
    voucher-deadline-warning.ts
    google-calendar-sync.ts
```

---

## 4. Database Tables (Key Fields)

### `profiles`
User identity + defaults.
- `id` (uuid, PK = auth user id), `username`, `email`
- `default_voucher_id`, `default_failure_cost_cents`, `currency` (EUR/USD/INR)
- `strict_pomo_enabled`, `default_pomo_duration_minutes`
- `deadline_one_hour_warning_enabled`, `deadline_final_warning_enabled`
- `voucher_can_view_active_tasks` â€” whether voucher can see owner's active tasks
- `default_event_duration_minutes`

### `tasks`
Core domain object.
- `id`, `user_id` (owner), `voucher_id`, `title`, `status`
- `deadline`, `failure_cost_cents`, `currency`
- `marked_completed_at`, `postponed_at`, `voucher_response_deadline`
- `recurrence_rule_id` (nullable FK â†’ `recurrence_rules`)
- `requires_proof` (bool), `has_proof` (bool â€” denormalized, set on accept)
- `proof_request_open`, `proof_requested_at`, `proof_requested_by`
- `voucher_timeout_auto_accepted` (bool)
- `is_event`, `google_sync_for_task`, `google_event_end_at`, `google_event_color_id`

### `task_events`
Immutable audit log. `task_id`, `event_type`, `actor_id`, `created_at`.

### `ledger_entries`
Financial log. `user_id`, `task_id`, `entry_type` (failure/rectified/force_majeure/voucher_timeout_penalty), `amount_cents`, `currency`, `period_year`, `period_month`.

### `task_completion_proofs`
Proof uploads. `task_id`, `upload_state` (PENDING/UPLOADED), `media_type`, `storage_object_path`.

### `pomo_sessions`
Pomodoro work sessions. `task_id`, `user_id`, `status` (ACTIVE/PAUSED/COMPLETED/DELETED), `elapsed_seconds`, `is_strict`.

### `recurrence_rules`
Templates for recurring tasks. `user_id`, `recurrence_type` (DAILY/WEEKLY/MONTHLY), `interval`, `template_title`, timezone fields.

### `commitments`
Commitment windows owned by a user. `name`, `status` (DRAFT/ACTIVE/COMPLETED/FAILED), `start_date`, `end_date`, timestamps.

### `commitment_task_links`
Links each commitment to either a one-off task or a recurrence rule. Exactly one of `task_id` or `recurrence_rule_id` is set.

### `rectify_passes`
Records of voucher-authorized rectifications. `task_id`, `authorized_by`, `period_year`, `period_month`. Max 5 per owner per month.

### `task_subtasks`
Subtasks on a task. Must all be `completed = true` before owner can mark task complete.

### `task_reminders`
Per-task reminders. `reminder_at`, `notified_at` (null = not yet sent), `offset_seconds`.

### `friendships`
Directed edges. Two rows per friendship (Aâ†’B and Bâ†’A). FK to `profiles`.

### `google_calendar_connections`
Per-user Google OAuth state. `encrypted_access_token`, `encrypted_refresh_token`, `selected_calendar_id`, `sync_app_to_google`, `sync_google_to_app`, `import_filter_tagged_only`.

### `google_calendar_sync_outbox`
Outbox queue for appâ†’Google sync operations.

---

## 5. Task Lifecycle

```
CREATED â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–º DELETED (voucher or owner <5min)
   â”‚
   â”œâ”€â–º POSTPONED (once, before deadline) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–º DELETED (voucher)
   â”‚         â”‚
   â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â–º AWAITING_VOUCHER (owner marks complete)
                        â”‚
              â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
              â–¼                   â–¼
          COMPLETED           FAILED
         (accept or          (deny or
          timeout)            missed deadline)
              â”‚                   â”‚
              â”‚              RECTIFIED (voucher authorizes, 7-day window, â‰¤5/month)
              â”‚                   â”‚
              â””â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                       â–¼
                   SETTLED (month-close email â€” tasks stay in DB state)
```

**Key rules:**
- Self-vouched tasks skip AWAITING_VOUCHER â†’ go directly to COMPLETED
- Voucher timeout auto-accepts (â†’ COMPLETED) and charges voucher 30 cents, not the owner
- Owner can postpone once per task
- Failure cost charged on: FAILED (via deny or missed deadline). Rectify creates negative ledger entry to cancel it.
- `SETTLED` state is sent in settlement email but tasks aren't DB-updated to SETTLED
- Commitment guards: `cancelRepetition` is blocked for DRAFT/ACTIVE linked commitments; owner temp-delete unlinks DRAFT links and blocks ACTIVE links; voucher delete blocks ACTIVE links.

---

## 6. Reputation System

**Location**: `src/lib/reputation/` + `src/actions/reputation.ts`

**Scale**: 0â€“1000. New users start around 400 (Bayesian smoothing with weight=20).

### Score Architecture

**Core score** = weighted average of active categories (weights redistribute if a category has no data):
| Category | Weight | How it's calculated |
|---|---|---|
| Delivery | 35% | `completed_with_timestamp / finalized_tasks Ã— 1000` |
| Accountability | 20% | Starts 1000, âˆ’80 per FAILED (Ã—decayÃ—consecutive mult), âˆ’25 per postpone |
| Community | 10% | Starts 1000, +15 per task vouched for others, âˆ’30 per timeout auto-accept |

**Bonus points** (additive, never penalize â€” only rewarded if features are used):
| Bonus | Cap | How |
|---|---|---|
| Discipline | +75 pts | Streak multipliers on recurring tasks (Ã—1.3 @7d, Ã—1.6 @14d, Ã—2.0 @30d) |
| Proof Quality | +50 pts | `tasks_with_proof / eligible_completed_non-selfvouch Ã— 1000` |
| Pomo | +50 pts | 1 pt per 10 min of pomo on completed tasks |

**Bayesian smoothing**: `(20 Ã— 400 + taskCount Ã— rawScore) / (20 + taskCount)`

**Velocity delta**: score now vs score 7 days ago (shown as â†‘/â†“ on the bar)

**Tiers**: Legendary(900+), Elite(800+), Trusted(700+), Solid(600+), Rising(500+), New Here(400+), Shaky(300+), Struggling(200+), Unreliable(0+)

### Data Used
```ts
// From tasks table (owned + vouched, excluding DELETED)
ReputationTaskInput {
  id, user_id, voucher_id, status, deadline,
  created_at, updated_at, marked_completed_at, postponed_at,
  recurrence_rule_id, voucher_timeout_auto_accepted,
  has_uploaded_proof,  // = has_proof column in DB
  pomo_total_seconds   // summed from pomo_sessions
}
```

### ReputationBar Component
`src/components/ReputationBar.tsx` â€” renders score/1000 as an orange gradient progress bar with velocity delta label. No tier label shown (just the number).

### Potential RP (pre-completion preview)
`src/lib/reputation/potential-rp.ts` â€” `computePotentialRpGain(tasks, taskId, userId)` pure function. Runs algorithm twice (current vs simulated COMPLETED), returns positive delta or 0.

- Task detail page (`src/app/dashboard/tasks/[id]/page.tsx`) fetches `getPotentialRpGain` server-side for CREATED/POSTPONED owner tasks, passes `potentialRp: number | null` to `TaskDetailClient`.
- `TaskDetailClient` shows **"You may earn +X RP"** in orange above action buttons (when `potentialRp > 0`).
- On mark complete success, fires `toast.success("You may earn +X RP")`.
- Frontend label is **RP** (Reputation Points). Backend variable/function names are unchanged.

---

## 7. Financial Rules

- Failure cost stored in cents. Currency per-user (`EUR`/`USD`/`INR`).
- App bounds: EUR/USD 1.00â€“100.00, INR 50â€“1000. DB hard bounds: 1â€“100000 cents.
- Ledger entry types: `failure` (+, owner charged), `rectified` (âˆ’, cancels failure), `voucher_timeout_penalty` (+, voucher charged 30Â¢), `force_majeure` (âˆ’, not yet implemented in UI)
- Monthly settlement job sends email summaries; does not execute payments.

---

## 8. Key Server Actions

| File | Action | What it does |
|---|---|---|
| `tasks.ts` | `createTask` | Full task creation with all tokens, recurrence, reminders |
| `tasks.ts` | `createTaskSimple` | Quick inline creation using profile defaults |
| `tasks.ts` | `markTaskCompleteWithProofIntent` | Mark complete, optionally start proof upload, set voucher deadline |
| `tasks.ts` | `finalizeTaskProofUpload` | After client uploads proof to storage, mark UPLOADED |
| `tasks.ts` | `undoTaskComplete` | Revert AWAITING_VOUCHER â†’ CREATED/POSTPONED (while deadline in future) |
| `commitments.ts` | `createCommitment` | Create a draft commitment window |
| `commitments.ts` | `addTaskLink` | Link a one-off task or recurrence rule to a draft commitment |
| `commitments.ts` | `activateCommitment` | Activate a draft commitment after guard checks |
| `commitments.ts` | `getCommitments` | List commitments with derived status, counters, and day statuses |
| `commitments.ts` | `getCommitmentDetail` | Fetch commitment detail with linked task instances in-range |
| `commitments.ts` | `notifyCommitmentFailureIfNeeded` | Send push/email if a linked task failure fails an active commitment |
| `commitments.ts` | `notifyCommitmentRevivedIfNeeded` | Recompute FAILED commitments after rectification and notify on revival |
| `voucher.ts` | `voucherAccept` | AWAITING_VOUCHER â†’ COMPLETED |
| `voucher.ts` | `voucherDeny` | AWAITING_VOUCHER â†’ FAILED + ledger entry |
| `voucher.ts` | `authorizeRectify` | FAILED â†’ RECTIFIED + negative ledger entry + commitment revival check |
| `voucher.ts` | `voucherRequestProof` | Set proof_request_open on task |
| `reputation.ts` | `getUserReputationScore` | Load tasks + pomo, compute full score |
| `reputation.ts` | `getPotentialRpGain` | Simulate task as COMPLETED, return score delta as potential RP |

---

## 9. Background Jobs (Trigger.dev)

| Job | Schedule | What it does |
|---|---|---|
| `deadline-fail` | Every 5 min | Fail CREATED/POSTPONED tasks past deadline; write ledger entries |
| `voucher-timeout` | Hourly | Auto-accept AWAITING_VOUCHER past voucher deadline; charge voucher 30Â¢ |
| `task-reminder-notify` | Every 1 min | Send push + email for due reminders |
| `recurrence-generator` | Scheduled | Generate next task from recurrence rules |
| `ledger-settlement` | Monthly | Email settlement summaries |
| `task-proof-cleanup` | Periodic | Delete stuck PENDING proofs after 20 min, stale proofs |
| `voucher-deadline-warning` | Scheduled | Warn voucher their review window is closing |
| `google-calendar-sync` | Minute sweep | Process outbox, renew watch subscriptions, reconcile stale connections |

---

## 10. Realtime & Caching

- **Realtime**: Supabase subscriptions on `tasks`, `friendships`, `pomo_sessions`, and `commitments`. Client emits `RealtimeTaskChange` + `RealtimeCommitmentChange` custom events on `window`; commitments pages refresh on either stream.
- **Cache tags**:
  - `tasks:active:{userId}` â€” TTL 60s, invalidated on task status change
  - `voucher:pending:{voucherId}` â€” TTL 300s, invalidated on voucher actions

---

## 11. Task Title Parser Tokens

`src/lib/task-title-parser.ts` â€” parses inline tokens from task title:

| Token | Meaning |
|---|---|
| `-end YYYY-MM-DD` or `tmrw`/`tomorrow`/weekday | Deadline |
| `-event` | Marks as calendar event |
| `-start HH:MM` / `-end HH:MM` | Event start/end time |
| `-color <name>` | Google Calendar color |
| `vouch <username>` or `.v <username>` | Set voucher |
| `pomo <n>` or `timer <n>` | Required pomodoro minutes |
| `remind <offset>` | Add reminder |
| `-proof` | Require proof on completion |

Ghost-text autocomplete in the input suggests completions; Tab accepts.

---

## 12. UI / Visual Conventions

- **VFD Pomodoro color**: `text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.6)]` â€” used for the timer display and the "Time Focused" stat.
- **Stat metric glows**: all stat numbers on stats and ledger pages use `drop-shadow` glows matching their text color. Colorâ†’glow map:
  - white â†’ `rgba(255,255,255,0.4)` (unused now, Active uses blue-400)
  - blue-400 (Active) â†’ `rgba(96,165,250,0.6)`
  - cyan-400 â†’ `rgba(34,211,238,0.6)`
  - purple-400 â†’ `rgba(192,132,252,0.6)`
  - lime-300 â†’ `rgba(190,242,100,0.6)`
  - red-500 â†’ `rgba(239,68,68,0.6)`
  - pink-500 â†’ `rgba(236,72,153,0.6)`
  - orange-400 â†’ `rgba(251,146,60,0.6)`
  - green-400 â†’ `rgba(74,222,128,0.6)`
- **Active task badge color**: `text-blue-400` (in `CompactStatsItem`). Also used for the Active stat metric in stats page.
- **Deadline badge on friends/voucher page**: turns red only when `hoursLeft < 1` (less than 1 hour to deadline).
- **Dashboard layout**: greeting row (`Hi username` + action buttons) on top, `ReputationBar` full-width below it, then `TaskInput`.
- **Confetti**: `fireCompletionConfetti()` from `src/lib/confetti.ts` fires on task completion; `fireCommitmentConfetti()` fires when a commitment transitions to COMPLETED (list/detail clients).
- **RP label**: frontend displays reputation as "RP". Backend names (`reputationScore`, `computeFullReputationScore`, etc.) are unchanged.

---

## 13. Known Incomplete / Gotchas

1. **Force majeure** â€” schema, types, and state machine support it, but no server action creates it. UI entry point doesn't exist.
2. **`SETTLED` status** â€” monthly email references it, but tasks are never DB-updated to SETTLED. Tasks stay in COMPLETED/FAILED/RECTIFIED permanently.
3. **Voucher response deadline** â€” XState says +7 days; actual server action (`getVoucherResponseDeadlineUtc`) is end-of-day + 2 days in user timezone. Use server action as truth.
4. **`has_proof` flag** â€” set by `voucherAccept` when proof cleanup happens; used by reputation's proof quality score. Self-vouched tasks never set it.
5. **Weekly recurrence with `interval > 1`** â€” not correctly implemented; falls through to always-run.
6. **`@ts-ignore` and `as any` casts** â€” `types.ts` wasn't regenerated after schema migrations. Expect TypeScript to complain on new Supabase queries.
7. **Commitment creation flow behavior** — inline-created tasks auto-link only when their deadline is inside the draft window; recurring inline creation links the series (not the generated instance).
