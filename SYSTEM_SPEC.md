# SYSTEM_SPEC.md

## 1) System Overview

- The runtime **MUST** be treated as a Next.js App Router application using Server Components, Server Actions, and Route Handlers as the write/read boundary. (Source: `src/app/**`, `src/actions/**`, `src/app/**/route.ts`)
- Supabase **MUST** be treated as the single persistent authority for Auth, Postgres, RLS, Storage, and Realtime delivery. (Source: `src/lib/supabase/*.ts`, `supabase/migrations/*.sql`, `src/components/RealtimeListener.tsx`)
- Trigger.dev scheduled jobs **MUST** be treated as asynchronous system actors for deadlines, reminders, recurrence generation, proof cleanup, and settlement emails. (Source: `src/trigger/*.ts`, `trigger.config.ts`)
- Runtime conflict precedence **MUST** be: **DB constraints + RLS > server actions/routes/jobs > client state/optimistic hints > README/legacy docs**. (Source: `supabase/migrations/*.sql`, `src/actions/*.ts`, `src/components/*`)

### 1.1 Consistency Model

- DB writes **MUST** be treated as strongly consistent once committed by Postgres. (Source: `src/actions/*.ts`, `src/trigger/*.ts`)
- UI synchronization **MUST** be treated as eventually consistent through Supabase Realtime + `router.refresh()` + cache revalidation. (Source: `src/components/RealtimeListener.tsx`, `src/app/dashboard/*client.tsx`)
- Optimistic UI **MAY** temporarily diverge from DB truth and **MUST** reconcile via rollback or subsequent refresh/realtime patch. (Source: `src/lib/ui/runOptimisticMutation.ts`, `src/app/dashboard/dashboard-client.tsx`, `src/app/dashboard/voucher/voucher-dashboard-client.tsx`, `src/app/dashboard/tasks/[id]/task-detail-client.tsx`)

### 1.2 Runtime Discrepancies You MUST Preserve

- Voucher review timeout behavior **MUST** follow runtime code (auto-accept on timeout with voucher penalty), even where older comments/docs differ. (Source: `src/actions/tasks.ts::getVoucherResponseDeadlineUtc`, `src/trigger/voucher-timeout.ts`)
- Task transition behavior **MUST** follow write paths, not XState comments, when they differ (for example direct `CREATED/POSTPONED -> AWAITING_VOUCHER` in runtime). (Source: `src/actions/tasks.ts::markTaskCompleteWithProofIntent`, `src/lib/xstate/task-machine.ts`)

---

## 2) Environment & External Services

| Env var | Consumed by | Required in prod | Required in dev | Failure behavior if missing |
|---|---|---:|---:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase browser/server/admin clients | Yes | Yes | Supabase client init fails; auth/db/storage calls break. (`createAdminClient` throws hard) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Supabase browser/server session clients | Yes | Yes | Auth/session/database calls from user clients fail. |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin Supabase client (jobs, proof/admin paths, cached admin queries) | Yes | Yes for admin paths/jobs | `createAdminClient` throws; jobs and admin operations fail. |
| `NEXT_PUBLIC_APP_URL` | Auth email redirects, deep links in notifications | Yes | Recommended | Missing causes broken/empty links or fallback localhost in some callsites. |
| `RESEND_API_KEY` | Email delivery bridge | Yes for email features | Optional | Email sends are skipped (warning/log); push may still send. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Client push subscription + server VAPID config | Yes for push | Optional | Push subscription UI disabled and server push skipped. |
| `VAPID_PRIVATE_KEY` | Server web-push | Yes for push | Optional | Push sending skipped with reason. |
| `VAPID_SUBJECT` | Server web-push | Yes for push | Optional | Push sending skipped with reason. |
| `NODE_ENV` | Cookie `secure`, debug logging toggles | Yes | Yes | Defaults may be unsafe/noisy if incorrect. |
| `VERCEL_ENV` | Build stamp label | No | No | Build label falls back to `NODE_ENV/local`. |
| `VERCEL_GIT_COMMIT_REF` | Build stamp label | No | No | Falls back to local git command or `unknown`. |
| `VERCEL_GIT_COMMIT_SHA` | Build stamp label | No | No | Falls back to local git command or `unknown`. |
| `VERCEL_GIT_COMMIT_MESSAGE` | Build stamp label | No | No | Falls back to local git command or `unknown`. |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Calendar OAuth flow | Yes for GCal | No | OAuth initiation fails |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google token exchange/refresh | Yes for GCal | No | Token exchange fails |
| `GOOGLE_OAUTH_REDIRECT_URI` | Google OAuth callback | Yes for GCal | No | OAuth redirect fails |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | AES-256-GCM token encryption | Yes for GCal | No | `encryptSecret`/`decryptSecret` throw |
| `GOOGLE_WEBHOOK_CHANNEL_TOKEN_SECRET` | Webhook auth validation | Yes for GCal | No | Webhook POST returns 403 |
| `GOOGLE_CALENDAR_WEBHOOK_URL` | Watch subscription setup | Yes for GCal | No | Watch channel setup fails |

- Trigger.dev runtime secrets/keys (for deployment/execution transport) are external to repository code and **MUST** be provisioned in Trigger.dev environment, but are not directly read in repo source. (Source: `trigger.config.ts`, `README.md`)

---

## 3) Database Schema Appendix (DB-First, Final State)

### 3.1 Global DB Rules

- `uuid-ossp` extension **MUST** be enabled for UUID defaults. (Source: `supabase/migrations/001_initial_schema.sql`)
- All table/constraint semantics below **MUST** reflect migrations `001` through `042` in lexical order. (Source: `supabase/migrations/*.sql`)

### 3.2 Tables

#### 3.2.1 `profiles`

- Purpose: user identity/profile defaults and notification/task visibility preferences. (Source: `001`, `009`, `012`, `019`, `021`, `022`, `023`, `024`, `030`, `039`)
- Columns **MUST** be:
  - `id uuid` PK, not null, FK -> `auth.users(id)` `ON DELETE CASCADE`
  - `email text` not null
  - `username text` not null, unique
  - `created_at timestamptz` not null default `now()`
  - `default_pomo_duration_minutes int` not null default `25`
  - `default_failure_cost_cents int` not null default `100`
  - `default_voucher_id uuid` nullable FK -> `profiles(id)` `ON DELETE SET NULL`
  - `hide_tips boolean` not null default `false`
  - `strict_pomo_enabled boolean` not null default `false`
  - `deadline_final_warning_enabled boolean` not null default `true`
  - `currency text` not null default `'EUR'`
  - `deadline_one_hour_warning_enabled boolean` not null default `true`
  - `voucher_can_view_active_tasks boolean` not null default `false`
  - `default_event_duration_minutes int` not null default `60`
- Constraints **MUST** include:
  - `profiles_default_pomo_duration_minutes_check` (`1..720`)
  - `profiles_default_failure_cost_cents_check` (`1..100000`)
  - `profiles_currency_check` (`EUR|USD|INR`)
  - `profiles_default_event_duration_minutes_check` (`1..720`)
- RLS **MUST** be enabled.
- Policies **MUST** be:
  - `Users can view all profiles` (`SELECT USING true`)
  - `Users can update own profile` (`UPDATE USING auth.uid() = id`)

#### 3.2.2 `friendships`

- Purpose: directed friendship edges; reciprocal behavior enforced in app layer/admin writes. (Source: `001`, `src/actions/friends.ts`)
- Columns **MUST** be:
  - `id uuid` PK default `uuid_generate_v4()`
  - `user_id uuid` not null FK -> `profiles(id)` `ON DELETE CASCADE`
  - `friend_id uuid` not null FK -> `profiles(id)` `ON DELETE CASCADE`
  - `created_at timestamptz` not null default `now()`
- Constraints/indexes **MUST** include:
  - `UNIQUE(user_id, friend_id)`
  - `CHECK(user_id <> friend_id)`
  - indexes `idx_friendships_user_id`, `idx_friendships_friend_id`
- RLS **MUST** be enabled.
- Policies **MUST** be:
  - `Users can view own friendships` (`SELECT USING auth.uid() = user_id`)
  - `Users can create friendships` (`INSERT WITH CHECK auth.uid() = user_id`)
  - `Users can delete own friendships` (`DELETE USING auth.uid() = user_id`)
- Realtime: in publication `supabase_realtime`; replica identity `FULL`. (Source: `006`, `014`)

#### 3.2.3 `tasks`

- Purpose: canonical task commitments and status lifecycle. (Source: `001`, `003`, `004`, `007`, `018`, `027`, `030`, `036`, `037`, `042`)
- Columns **MUST** be:
  - `id uuid` PK default `uuid_generate_v4()`
  - `user_id uuid` not null FK -> `profiles(id)` `ON DELETE CASCADE`
  - `voucher_id uuid` not null FK -> `profiles(id)` `ON DELETE CASCADE`
  - `title text` not null
  - `description text` nullable
  - `failure_cost_cents int` not null
  - `deadline timestamptz` not null
  - `status text` not null default `'CREATED'`
  - `postponed_at timestamptz` nullable
  - `marked_completed_at timestamptz` nullable
  - `voucher_response_deadline timestamptz` nullable
  - `created_at timestamptz` not null default `now()`
  - `updated_at timestamptz` not null default `now()`
  - `recurrence_rule_id uuid` nullable FK -> `recurrence_rules(id)` `ON DELETE SET NULL`
  - `required_pomo_minutes int` nullable
  - `proof_request_open boolean` not null default `false`
  - `proof_requested_at timestamptz` nullable
  - `proof_requested_by uuid` nullable FK -> `profiles(id)` `ON DELETE SET NULL`
  - `google_sync_for_task boolean` not null default `false`
  - `google_event_end_at timestamptz` nullable
  - `google_event_color_id text` nullable
- Constraints **MUST** include:
  - `tasks_status_check` in `CREATED,POSTPONED,MARKED_COMPLETED,AWAITING_VOUCHER,COMPLETED,FAILED,RECTIFIED,SETTLED,DELETED`
  - `tasks_failure_cost_cents_check` (`1..100000`)
  - `tasks_required_pomo_minutes_check` (`NULL OR 1..10000`)
  - `tasks_google_event_color_id_check` (`NULL OR '1'..'11'`)
- Indexes **MUST** include:
  - `idx_tasks_user_id`, `idx_tasks_voucher_id`, `idx_tasks_status`, `idx_tasks_deadline`
  - `idx_tasks_recurrence_rule_id`
  - partial `idx_tasks_owner_open_proof_requests` on `(user_id)` where `proof_request_open=true AND status IN ('AWAITING_VOUCHER','MARKED_COMPLETED')`
- RLS **MUST** be enabled.
- Policies **MUST** be:
  - `Users can view own tasks` (`SELECT USING auth.uid() = user_id`)
  - `Vouchers can view assigned tasks` (`SELECT USING auth.uid() = voucher_id`)
  - `Users can create own tasks` (`INSERT WITH CHECK auth.uid() = user_id`)
  - `Users can update own tasks` (`UPDATE USING auth.uid() = user_id`)
  - `Vouchers can update assigned tasks` (`UPDATE USING auth.uid() = voucher_id`)
  - `Vouchers can delete assigned tasks` (`DELETE USING auth.uid() = voucher_id`)
- Trigger `tasks_updated_at` **MUST** set `updated_at = now()` on update. (Source: `001`)
- Realtime: in publication `supabase_realtime`; replica identity `FULL`. (Source: `006`, `014`)

#### 3.2.4 `task_events`

- Purpose: audit/event feed for task transitions and reminders/pomodoro events. (Source: `001`, `002_make_actor_id_nullable`)
- Columns **MUST** be:
  - `id uuid` PK default `uuid_generate_v4()`
  - `task_id uuid` not null FK -> `tasks(id)` `ON DELETE CASCADE`
  - `event_type text` not null
  - `actor_id uuid` nullable FK -> `profiles(id)` (default delete action = `NO ACTION`)
  - `from_status text` not null
  - `to_status text` not null
  - `metadata jsonb` nullable
  - `created_at timestamptz` not null default `now()`
- Index **MUST** include `idx_task_events_task_id`.
- RLS **MUST** be enabled.
- Policies **MUST** be:
  - `Users can view events for own tasks` (task owner or voucher)
  - `System can insert events` (`INSERT WITH CHECK auth.uid() = actor_id`)

#### 3.2.5 `ledger_entries`

- Purpose: monthly monetary ledger deltas (+failure/penalties, -rectify/force majeure). (Source: `001`, `010`)
- Columns **MUST** be:
  - `id uuid` PK default `uuid_generate_v4()`
  - `user_id uuid` not null FK -> `profiles(id)` `ON DELETE CASCADE`
  - `task_id uuid` not null FK -> `tasks(id)` `ON DELETE CASCADE`
  - `period text` not null (`YYYY-MM`)
  - `amount_cents int` not null
  - `entry_type text` not null
  - `created_at timestamptz` not null default `now()`
- Constraints/indexes **MUST** include:
  - `ledger_entries_entry_type_check` in `failure,rectified,force_majeure,voucher_timeout_penalty`
  - `idx_ledger_user_period`
- RLS **MUST** be enabled.
- Policies **MUST** be:
  - `Users can view own ledger` (`SELECT USING auth.uid() = user_id`)
  - `System can insert ledger entries` (`INSERT WITH CHECK auth.uid() = user_id`)

#### 3.2.6 `rectify_passes`

- Purpose: monthly rectify pass usage records. (Source: `001`, `029`)
- Columns **MUST** be:
  - `id uuid` PK default `uuid_generate_v4()`
  - `user_id uuid` not null FK -> `profiles(id)` `ON DELETE CASCADE`
  - `task_id uuid` not null FK -> `tasks(id)` `ON DELETE CASCADE`
  - `authorized_by uuid` nullable FK -> `profiles(id)` `ON DELETE SET NULL`
  - `period text` not null
  - `created_at timestamptz` not null default `now()`
- RLS **MUST** be enabled.
- Policies **MUST** be:
  - `Users can view own rectify passes` (`SELECT USING auth.uid() = user_id`)
  - `Vouchers can view authorized passes` (`SELECT USING auth.uid() = authorized_by`)
  - `System can insert rectify passes` (voucher must be actor and assigned voucher on task)

#### 3.2.7 `force_majeure`

- Purpose: one-per-period force majeure usage records. (Source: `001`)
- Columns **MUST** be:
  - `id uuid` PK default `uuid_generate_v4()`
  - `user_id uuid` not null FK -> `profiles(id)` `ON DELETE CASCADE`
  - `task_id uuid` not null FK -> `tasks(id)` `ON DELETE CASCADE`
  - `period text` not null
  - `created_at timestamptz` not null default `now()`
- RLS **MUST** be enabled.
- Policies **MUST** be:
  - `Users can view own force majeure`
  - `Users can insert own force majeure`

#### 3.2.8 `web_push_subscriptions`

- Purpose: per-user push subscriptions for Web Push delivery. (Source: `005`)
- Columns **MUST** be:
  - `id uuid` PK default `uuid_generate_v4()`
  - `user_id uuid` nullable FK -> `auth.users(id)` `ON DELETE CASCADE`
  - `subscription jsonb` not null
  - `created_at timestamptz` not null default `timezone('utc', now())`
  - `updated_at timestamptz` not null default `timezone('utc', now())`
- Constraints **MUST** include `UNIQUE(user_id, subscription)`.
- RLS **MUST** be enabled.
- Policies **MUST** be:
  - insert/view/delete own by `auth.uid() = user_id`

#### 3.2.9 `recurrence_rules`

- Purpose: templates for generating future recurring tasks. (Source: `007`, `018`, `028`, `029`, `036`, `037`, `042`)
- Columns **MUST** be:
  - `id uuid` PK default `uuid_generate_v4()`
  - `user_id uuid` not null FK -> `profiles(id)` `ON DELETE CASCADE`
  - `voucher_id uuid` not null FK -> `profiles(id)` `ON DELETE CASCADE`
  - `title text` not null
  - `description text` nullable
  - `failure_cost_cents int` not null
  - `rule_config jsonb` not null
  - `timezone text` not null default `'UTC'`
  - `active boolean` not null default `true`
  - `last_generated_date date` nullable
  - `created_at timestamptz` not null default `now()`
  - `updated_at timestamptz` not null default `now()`
  - `required_pomo_minutes int` nullable
  - `manual_reminder_offsets_ms jsonb` nullable
  - `google_sync_for_rule boolean` not null default `false`
  - `google_event_duration_minutes int` nullable
  - `google_event_color_id text` nullable
- Constraints/indexes **MUST** include:
  - `recurrence_rules_required_pomo_minutes_check` (`NULL OR 1..10000`)
  - `recurrence_rules_manual_reminder_offsets_ms_is_array` (`NULL OR json array`)
  - `recurrence_rules_google_event_color_id_check` (`NULL OR '1'..'11'`)
  - partial index `idx_recurrence_rules_active` where `active=true`
- RLS **MUST** be enabled.
- Policies **MUST** be owner-only select/insert/update/delete by `user_id`.

#### 3.2.10 `pomo_sessions`

- Purpose: pomodoro/focus session tracking per task. (Source: `008`, `019`, `020`, `041`)
- Columns **MUST** be:
  - `id uuid` PK default `uuid_generate_v4()`
  - `user_id uuid` not null FK -> `profiles(id)` `ON DELETE CASCADE`
  - `task_id uuid` not null FK -> `tasks(id)` `ON DELETE CASCADE`
  - `duration_minutes int` not null
  - `elapsed_seconds int` not null default `0`
  - `status text` not null default `'ACTIVE'`
  - `started_at timestamptz` not null default `now()`
  - `paused_at timestamptz` nullable
  - `completed_at timestamptz` nullable
  - `created_at timestamptz` not null default `now()`
  - `updated_at timestamptz` not null default `now()`
  - `is_strict boolean` not null default `false`
- Constraints/indexes **MUST** include:
  - status check in `ACTIVE,PAUSED,COMPLETED,DELETED`
  - unique partial index `idx_single_active_or_paused_pomo` on `(user_id)` where `status IN ('ACTIVE','PAUSED')`
  - `idx_pomo_sessions_task_id`
- Trigger `pomo_sessions_updated_at` **MUST** maintain `updated_at`.
- RLS **MUST** be enabled.
- Policies **MUST** include:
  - owner manage policy (`Users can manage own pomo sessions`)
  - friend read policy (`Friends can view active or paused pomo sessions`)
- Realtime: in publication `supabase_realtime`; replica identity `FULL`. (Source: `013`)

#### 3.2.11 `voucher_reminder_logs`

- Purpose: daily digest dedupe for voucher pending reminders. (Source: `010`)
- Columns **MUST** be:
  - `id uuid` PK default `uuid_generate_v4()`
  - `voucher_id uuid` not null FK -> `profiles(id)` `ON DELETE CASCADE`
  - `reminder_date date` not null
  - `pending_count int` not null check `>=0`
  - `created_at timestamptz` not null default `now()`
- Constraints/indexes **MUST** include:
  - `UNIQUE(voucher_id, reminder_date)`
  - `idx_voucher_reminder_logs_voucher_date`
- RLS **MUST** be enabled.
- Policies **MUST** be select/insert own by `voucher_id`.

#### 3.2.12 `task_subtasks`

- Purpose: optional checklist items under a parent task. (Source: `011`)
- Columns **MUST** be:
  - `id uuid` PK default `uuid_generate_v4()`
  - `parent_task_id uuid` not null FK -> `tasks(id)` `ON DELETE CASCADE`
  - `user_id uuid` not null FK -> `profiles(id)` `ON DELETE CASCADE`
  - `title text` not null
  - `is_completed boolean` not null default `false`
  - `completed_at timestamptz` nullable
  - `created_at timestamptz` not null default `now()`
  - `updated_at timestamptz` not null default `now()`
- Constraints/indexes **MUST** include:
  - `task_subtasks_title_not_blank` (`char_length(btrim(title)) > 0`)
  - `idx_task_subtasks_parent_task_id`
  - `idx_task_subtasks_parent_created_at`
- Triggers/functions **MUST** include:
  - `task_subtasks_updated_at` (`update_updated_at`)
  - `task_subtasks_limit` (`enforce_task_subtask_limit`) enforcing max 20 subtasks per parent task
- RLS **MUST** be enabled.
- Policies **MUST** be owner-only select/insert/update/delete by `user_id`.

#### 3.2.13 `task_reminders`

- Purpose: owner reminders attached to a task (manual and seeded defaults). (Source: `015`, `025`, `026`)
- Columns **MUST** be:
  - `id uuid` PK default `uuid_generate_v4()`
  - `parent_task_id uuid` not null FK -> `tasks(id)` `ON DELETE CASCADE`
  - `user_id uuid` not null FK -> `profiles(id)` `ON DELETE CASCADE`
  - `reminder_at timestamptz` not null
  - `notified_at timestamptz` nullable
  - `created_at timestamptz` not null default `now()`
  - `updated_at timestamptz` not null default `now()`
  - `source text` not null default `'MANUAL'`
- Constraints/indexes **MUST** include:
  - `UNIQUE(parent_task_id, reminder_at)`
  - `task_reminders_source_check` in `MANUAL,DEFAULT_DEADLINE_1H,DEFAULT_DEADLINE_5M`
  - partial index `idx_task_reminders_due` on `reminder_at` where `notified_at IS NULL`
  - `idx_task_reminders_parent_reminder`
- Trigger `task_reminders_updated_at` **MUST** maintain `updated_at`.
- RLS **MUST** be enabled.
- Policies **MUST** be owner-only select/insert/update/delete by `user_id`.

#### 3.2.14 `task_completion_proofs`

- Purpose: metadata pointer to private proof media object for voucher review window. (Source: `016`, `017`, `031`)
- Columns **MUST** be:
  - `id uuid` PK default `uuid_generate_v4()`
  - `task_id uuid` not null FK -> `tasks(id)` `ON DELETE CASCADE`
  - `owner_id uuid` not null FK -> `profiles(id)` `ON DELETE CASCADE`
  - `voucher_id uuid` not null FK -> `profiles(id)` `ON DELETE CASCADE`
  - `bucket text` not null default `'task-proofs'`
  - `object_path text` not null
  - `media_kind text` not null
  - `mime_type text` not null
  - `size_bytes int` not null
  - `duration_ms int` nullable
  - `upload_state text` not null default `'PENDING'`
  - `created_at timestamptz` not null default `now()`
  - `updated_at timestamptz` not null default `now()`
- Constraints/indexes **MUST** include:
  - `UNIQUE(task_id)`
  - `UNIQUE(bucket, object_path)`
  - `media_kind` in `image,video`
  - `size_bytes > 0 AND <= 5242880`
  - `duration_ms IS NULL OR (duration_ms > 0 AND <= 15000)`
  - `upload_state` in `PENDING,UPLOADED,FAILED`
  - `idx_task_completion_proofs_voucher`, `idx_task_completion_proofs_task`, `idx_task_completion_proofs_state`
  - `task_completion_proofs_bucket_fixed` CHECK (`bucket = 'task-proofs'`)
- Trigger `task_completion_proofs_updated_at` **MUST** maintain `updated_at`.
- Trigger `task_completion_proofs_prevent_location_mutation` **MUST** make `bucket`, `object_path`, `owner_id`, `voucher_id`, `task_id` immutable on UPDATE. (Source: `031`)
- RLS **MUST** be enabled.
- Policies **MUST** be:
  - owner select
  - voucher select assigned
  - owner insert (with task ownership and voucher consistency check)
  - owner update/delete

#### 3.2.15 `google_calendar_connections`

- Purpose: per-user Google Calendar OAuth link with encrypted tokens, directional sync controls, and watch subscription for push notifications. (Source: `032`, `035`→`037` removed cursor, `038`, `040`)
- Columns **MUST** be:
  - `user_id uuid` PK, FK -> `auth.users(id)` `ON DELETE CASCADE`
  - `sync_enabled boolean` not null default `false`
  - `sync_app_to_google_enabled boolean` not null default `false`
  - `sync_google_to_app_enabled boolean` not null default `false`
  - `import_only_tagged_google_events boolean` not null default `false`
  - `google_account_email text` nullable
  - `selected_calendar_id text` nullable
  - `selected_calendar_summary text` nullable
  - `encrypted_access_token text` nullable
  - `encrypted_refresh_token text` nullable
  - `token_expires_at timestamptz` nullable
  - `watch_channel_id text` nullable
  - `watch_resource_id text` nullable
  - `watch_expires_at timestamptz` nullable
  - `sync_token text` nullable
  - `last_webhook_at timestamptz` nullable
  - `last_sync_at timestamptz` nullable
  - `last_error text` nullable
  - `created_at timestamptz` not null default `now()`
  - `updated_at timestamptz` not null default `now()`
- RLS **MUST** be enabled.
- Policies **MUST** be owner-only CRUD by `user_id`.
- Trigger `update_updated_at` **MUST** maintain `updated_at`.

#### 3.2.16 `google_calendar_task_links`

- Purpose: mapping between app tasks and Google Calendar events for sync tracking. (Source: `032`, `034`→`037` removed item_kind)
- Columns **MUST** be:
  - `task_id uuid` PK, FK -> `tasks(id)` `ON DELETE CASCADE`
  - `user_id uuid` not null FK -> `auth.users(id)` `ON DELETE CASCADE`
  - `calendar_id text` not null
  - `google_event_id text` not null
  - `last_google_etag text` nullable
  - `last_google_updated_at timestamptz` nullable
  - `last_app_updated_at timestamptz` nullable
  - `last_origin text` nullable (`APP|GOOGLE`)
  - `created_at timestamptz` not null default `now()`
  - `updated_at timestamptz` not null default `now()`
- Constraints **MUST** include:
  - `UNIQUE(user_id, calendar_id, google_event_id)`
- RLS **MUST** be enabled.
- Policies **MUST** be owner select only by `user_id`.
- Trigger `update_updated_at` **MUST** maintain `updated_at`.

#### 3.2.17 `google_calendar_sync_outbox`

- Purpose: queued app→Google mutations with retry semantics. (Source: `032`, `033`)
- Columns **MUST** be:
  - `id bigserial` PK
  - `user_id uuid` not null FK -> `auth.users(id)` `ON DELETE CASCADE`
  - `task_id uuid` nullable FK -> `tasks(id)` `ON DELETE SET NULL`
  - `intent text` not null (`UPSERT|DELETE`)
  - `status text` not null default `'PENDING'` (`PENDING|PROCESSING|DONE|FAILED`)
  - `attempt_count int` not null default `0`
  - `next_attempt_at timestamptz` nullable
  - `payload jsonb` nullable
  - `last_error text` nullable
  - `created_at timestamptz` not null default `now()`
  - `updated_at timestamptz` not null default `now()`
- Indexes **MUST** include:
  - `idx_google_calendar_outbox_pending`
  - `idx_google_calendar_outbox_user`
- RLS **MUST** be enabled.
- Policies **MUST** be owner select only by `user_id`.
- Realtime: in publication `supabase_realtime`. (Source: `033`)
- Trigger `update_updated_at` **MUST** maintain `updated_at`.

### 3.3 Storage Buckets & Object Policies

- Bucket `task-proofs` **MUST** exist as private (`public=false`), file size limit `5242880`, mime allowlist: `image/jpg,image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm`. (Source: `016`, `017`)
- Proof object paths **MUST** follow `ownerId/taskId/random.ext`. (Source: `src/lib/task-proof-shared.ts::buildTaskProofObjectPath`)
- `storage.objects` policies **MUST** allow authenticated owner insert/update/delete only under `bucket_id='task-proofs'` with first folder segment `auth.uid()` and task ownership checks on insert. (Source: `016`)
- Proof retrieval **MUST NOT** rely on direct storage public access; it is mediated through signed/admin server download route. (Source: `src/app/api/task-proofs/[taskId]/route.ts`)

### 3.4 SQL Functions & Triggers

- `public.handle_new_user` (`SECURITY DEFINER`) **MUST** insert profile rows on auth user creation; final version **MUST** set `default_voucher_id = NEW.id`. (Source: `001`, `024`)
- `current_period()`, `rectify_passes_used(uuid)`, `force_majeure_available(uuid)` **MUST** exist as helper functions (not required by app writes but part of schema). (Source: `001`)
- `update_updated_at()` **MUST** stamp `updated_at` in trigger-backed tables. (Source: `001`, `008`)
- `enforce_task_subtask_limit()` **MUST** raise exception when parent subtasks exceed 20. (Source: `011`)
- `prevent_task_proof_location_mutation()` **MUST** raise exception when `bucket`, `object_path`, `owner_id`, `voucher_id`, or `task_id` are changed on UPDATE. (Source: `031`)

### 3.5 Realtime Publication & Replica Identity

- Realtime publication membership **MUST** include: `public.tasks`, `public.friendships`, `public.pomo_sessions`, `public.google_calendar_sync_outbox`. (Source: `006`, `013`, `014`, `033`)
- Replica identity **MUST** be `FULL` on `tasks`, `friendships`, `pomo_sessions`. (Source: `006`, `013`, `014`)

---

## 4) Domain Glossary

- **Task**: owner commitment record with cost, deadline, voucher, and lifecycle status. (Source: `tasks`)
- **Voucher**: designated reviewer (`tasks.voucher_id`) who can accept/deny/delete and request proof for awaiting tasks. (Source: `src/actions/voucher.ts`)
- **Owner**: task creator (`tasks.user_id`) who bears failure cost and edits active task details. (Source: `src/actions/tasks.ts`)
- **Friendship**: directed edge in `friendships`; app writes reciprocal edges. (Source: `src/actions/friends.ts`)
- **Ledger Entry**: monetary delta row in `ledger_entries` by period and type. (Source: `ledger_entries`)
- **Rectify Pass**: voucher-authorized reversal record (`rectify_passes`) for failed tasks (max 5/month in runtime policy). (Source: `src/actions/voucher.ts::authorizeRectify`)
- **Force Majeure**: owner monthly waiver record (`force_majeure`) that settles failed task and creates offset ledger entry. (Source: `src/actions/tasks.ts::forceMajeureTask`)
- **Recurrence Rule**: template row in `recurrence_rules` used by scheduled generator to create future tasks. (Source: `src/trigger/recurrence-generator.ts`)
- **Reminder**: `task_reminders` row (`MANUAL` or default seeded deadline warning sources). (Source: `src/lib/task-reminder-defaults.ts`)
- **Completion Proof**: metadata row + private storage object used during voucher review window. (Source: `task_completion_proofs`, `task-proofs` bucket)
- **Pomodoro Session**: tracked focus session (`pomo_sessions`) counted on completion. (`is_strict` exists in schema for backward compatibility but is not used by runtime behavior.) (Source: `src/actions/tasks.ts`)
- **Defaults/Profile**: per-user task/pomo/currency/notification/visibility defaults in `profiles`. (Source: `src/actions/auth.ts::updateUserDefaults`)
- **Event Task**: task with `-event` flag, scheduled via `-start`/`-end` tokens, syncs to Google Calendar as calendar event with optional color. (Source: `src/actions/tasks.ts`, `src/trigger/recurrence-generator.ts`)
- **Google Calendar Connection**: per-user OAuth link with encrypted tokens, directional sync controls, and watch subscription for push notifications. (Source: `google_calendar_connections`, `src/actions/google-calendar.ts`)
- **Google Calendar Sync Outbox**: queued app→Google mutations with retry semantics; processed by dispatch job and swept by sweeper. (Source: `google_calendar_sync_outbox`, `src/trigger/google-calendar-sync.ts`)

---

## 5) State Machines & Invariants

## 5.1 `tasks.status` Runtime Machine (Authoritative)

### 5.1.1 States

- Valid DB states **MUST** be exactly: `CREATED`, `POSTPONED`, `MARKED_COMPLETED`, `AWAITING_VOUCHER`, `COMPLETED`, `FAILED`, `RECTIFIED`, `SETTLED`, `DELETED`. (Source: `tasks_status_check`, `supabase/migrations/004_remove_active_status.sql`)
- `MARKED_COMPLETED` **MAY** exist in data but is not actively written by current primary completion path. (Source: `src/actions/tasks.ts::markTaskCompleteWithProofIntent`)

### 5.1.2 Transitions (Actor / Preconditions / Writes / Side-effects / Idempotency)

- `CREATE` (`system|owner`) **MUST** create `CREATED` rows from:
  - `createTask`, `createTaskSimple`, `recurrenceGenerator`.
  - Side effects: optional recurrence rule insert, reminders/subtasks inserts, `task_events.CREATED`, cache/path invalidation.
  - Idempotency: no strict dedupe key on title/deadline; duplicate creates are possible.
  (Source: `src/actions/tasks.ts::createTask`, `src/actions/tasks.ts::createTaskSimple`, `src/trigger/recurrence-generator.ts::processRule`)

- `POSTPONE` (`owner`) **MUST** transition `CREATED -> POSTPONED` when deadline future, not already postponed, and transition guard passes.
  - Writes: task deadline/status/postponed_at; reminder realignment; `task_events.POSTPONE`.
  - Idempotency: not idempotent; update is not conditional on old status at write time.
  (Source: `src/actions/tasks.ts::postponeTask`)

- `MARK_COMPLETE_SELF` (`owner=self voucher`) **MUST** transition `CREATED|POSTPONED -> COMPLETED`.
  - Preconditions: before deadline, no incomplete subtasks, required pomodoro met.
  - Writes: clear proof flags, proof cleanup, `task_events.MARK_COMPLETE` with self-vouch metadata.
  - Guard: conditional update by owner/status/deadline prevents stale write.
  (Source: `src/actions/tasks.ts::markTaskCompleteWithProofIntent`)

- `MARK_COMPLETE_FOR_VOUCHER` (`owner`) **MUST** transition `CREATED|POSTPONED -> AWAITING_VOUCHER`.
  - Preconditions: same as above; voucher not self path.
  - Writes: sets `marked_completed_at`, computed `voucher_response_deadline` (~+2 local days end-of-day), clears proof request flags; optional proof row upsert + signed upload target.
  - Rollback: on proof setup/sign-url failure, task reverts to active status and proof media is cleaned.
  (Source: `src/actions/tasks.ts::markTaskCompleteWithProofIntent`)

- `UNDO_COMPLETE` (`owner`) **MUST** transition `AWAITING_VOUCHER -> CREATED|POSTPONED` when deadline still future.
  - Writes: clear completion/proof request fields, delete proof media, insert event (`UNDO_COMPLETE` or `PROOF_UPLOAD_FAILED_REVERT`).
  - Guard: conditional update by `status='AWAITING_VOUCHER'` and `deadline > now`.
  (Source: `src/actions/tasks.ts::undoTaskComplete`, `src/actions/tasks.ts::revertTaskCompletionAfterProofFailure`)

- `VOUCHER_ACCEPT` (`voucher`) **MUST** transition `AWAITING_VOUCHER -> COMPLETED`.
  - Writes: task status, proof cleanup, `task_events.VOUCHER_ACCEPT`.
  - Idempotency: no conditional old-status check in update statement; repeated writes may overwrite unchanged state.
  (Source: `src/actions/voucher.ts::voucherAccept`)

- `VOUCHER_DENY` (`voucher`) **MUST** transition `AWAITING_VOUCHER -> FAILED`.
  - Writes: task status, proof cleanup, ledger failure entry attempt, `task_events.VOUCHER_DENY`, owner notification.
  - Idempotency: no unique ledger/event dedupe.
  (Source: `src/actions/voucher.ts::voucherDeny`)

- `VOUCHER_TIMEOUT` (`system job`) **MUST** transition `AWAITING_VOUCHER (deadline passed) -> COMPLETED`.
  - Writes: conditional status update (`eq status AWAITING_VOUCHER`), proof cleanup, voucher penalty ledger entry, `task_events.VOUCHER_TIMEOUT`.
  - Idempotency: guarded update prevents double state transition; ledger/event still not globally unique.
  (Source: `src/trigger/voucher-timeout.ts`)

- `DEADLINE_FAIL` (`system job` and read-path side effect) **MUST** transition `CREATED|POSTPONED (effective due time passed) -> FAILED`.
  - Effective due time **MUST** always be `deadline`.
  - Writes: task status, owner failure ledger entry, `task_events.DEADLINE_MISSED`; enqueues Google Calendar outbox for failed event tasks.
  - Concurrency caveat: both read-path and cron can run; no uniqueness protection on ledger/event duplicates.
  (Source: `src/trigger/deadline-fail.ts`, `src/actions/tasks.ts::getTask`)

- `RECTIFY` (`voucher`) **MUST** transition `FAILED -> RECTIFIED` when within 7-day window and owner has <5 passes in period.
  - Writes: task status, rectify_pass row, negative ledger entry attempt, `task_events.RECTIFY`.
  - Window basis: `task.updated_at + 7d`.
  (Source: `src/actions/voucher.ts::authorizeRectify`)

- `FORCE_MAJEURE` (`owner`) **MUST** transition `FAILED -> SETTLED` when monthly force majeure count < 1.
  - Writes: task status, force_majeure row, negative ledger entry, `task_events.FORCE_MAJEURE`.
  (Source: `src/actions/tasks.ts::forceMajeureTask`)

- `VOUCHER_DELETE_SOFT` (`voucher`) **MUST** transition non-final task statuses (`CREATED|POSTPONED|MARKED_COMPLETED|AWAITING_VOUCHER`) -> `DELETED`.
  - Writes: status + proof request clear + `updated_at`, proof cleanup, `task_events.VOUCHER_DELETE`, owner notification.
  (Source: `src/actions/voucher.ts::voucherDeleteTask`)

- `OWNER_TEMP_DELETE_HARD` (`owner`) **MUST** physically delete task row (not status transition) only in `CREATED|POSTPONED` within 10-minute window from `created_at`.
  - Writes: hard row delete via admin client.
  - Effect: cascading deletes remove subtasks/reminders/proofs/events/ledger links via FK.
  (Source: `src/actions/tasks.ts::ownerTempDeleteTask`, `src/lib/task-delete-window.ts`)

### 5.1.3 Cross-layer Winner Rules

- If client/XState expectation conflicts with DB/server write path, runtime DB+write path **MUST** win.
  - Example: XState includes `TIMEOUT_24H` and 7-day deadline comments; runtime computes +2-day local deadline and timeout job auto-accepts.
  (Source: `src/lib/xstate/task-machine.ts`, `src/actions/tasks.ts::getVoucherResponseDeadlineUtc`, `src/trigger/voucher-timeout.ts`)

## 5.2 `pomo_sessions.status` Runtime Machine

- States **MUST** be `ACTIVE|PAUSED|COMPLETED|DELETED`. (Source: `008`)
- `startPomoSession` **MUST** create `ACTIVE`; one concurrent active-or-paused session is DB-enforced via `idx_single_active_or_paused_pomo` for `ACTIVE` and `PAUSED` statuses. (Source: `src/actions/tasks.ts::startPomoSession`, `041`)
- `pausePomoSession` **MUST** require active session and compute elapsed time delta. (Source: `src/actions/tasks.ts::pausePomoSession`)
- `resumePomoSession` **MUST** require paused session. (Source: `src/actions/tasks.ts::resumePomoSession`)
- `endPomoSession` **MUST** set terminal status to `COMPLETED` for non-terminal sessions, log completion events, and remain idempotent for already-terminal sessions. (Source: `src/actions/tasks.ts::endPomoSession`)

## 5.3 Proof Upload State Machine

- `task_completion_proofs.upload_state` **MUST** use `PENDING|UPLOADED|FAILED`. (Source: `016`)
- Initialization **MUST** create/upsert `PENDING` proof row before upload URL issuance. (Source: `markTaskCompleteWithProofIntent`, `initAwaitingVoucherProofUpload`)
- Finalization **MUST** verify bucket/object path match and then set `UPLOADED`. (Source: `finalizeTaskProofUpload`)
- Scheduled cleanup **MUST** delete stale/expired/non-awaiting proofs and underlying objects. (Source: `src/trigger/task-proof-cleanup.ts`)

---

## 6) API & Server-Action Contract Reference

### 6.1 Route Handlers

- `GET /auth/callback` (`src/app/auth/callback/route.ts::GET`)
  - Inputs **MUST** be query params: `code` OR (`token_hash`,`type`), optional `next`.
  - Auth requirement: none; this endpoint establishes auth session.
  - Behavior order **MUST** be: parse params -> exchange/verify with Supabase -> redirect success to `${origin}${next}` else redirect `/login?error=...`.
  - Outputs **MUST** be redirects only.

- `POST /api/pomo/auto-end` (`src/app/api/pomo/auto-end/route.ts::POST`)
  - Inputs **MAY** include JSON body `{sessionId?: string}`.
  - Auth **MUST** be required (401 if missing).
  - Behavior order **MUST** be: resolve active session -> conditional update ACTIVE->(COMPLETED/DELETED) -> if counted log event + send push -> return `{success:true}` or `{success:true, noop:true}`.
  - Typical errors **MUST** include `{error:"Not authenticated"}` (401) or DB errors (500).
  - Note: in-repo callers are not present. (Source: repository search)

- `GET /api/task-proofs/[taskId]` (`src/app/api/task-proofs/[taskId]/route.ts::GET`)
  - Auth **MUST** be required.
  - Access checks **MUST** run in order: same-origin fetch hardening (`sec-fetch-*`) -> task exists -> caller is owner or voucher -> status in `AWAITING_VOUCHER|MARKED_COMPLETED` -> not past `voucher_response_deadline` (if set) -> proof row exists + `upload_state='UPLOADED'` -> admin storage download.
  - Success output **MUST** be binary response with strict no-store and `Content-Disposition:inline`.
  - Failure output **MUST** be no-store JSON errors (`401/403/404/410`).

- `GET /api/integrations/google/callback` (`src/app/api/integrations/google/callback/route.ts::GET`)
  - Inputs **MUST** be query params: `code`, `state`, optional `error`.
  - Auth **MUST** be required (unauthenticated → redirect to `/login?error=not_authenticated`).
  - Behavior order **MUST** be: check error param (→ `?googleCalendar=oauth_denied`) -> validate code+state presence (→ `?googleCalendar=missing_code`) -> validate CSRF state cookie (→ `?googleCalendar=invalid_state`) -> exchange code for tokens -> extract email from id_token -> upsert connection -> redirect to `/dashboard/settings?googleCalendar=connected`.
  - On exception: redirects to `/dashboard/settings?googleCalendar=connect_failed`.
  - Outputs **MUST** be redirects only.

- `POST /api/integrations/google/webhook` (`src/app/api/integrations/google/webhook/route.ts::POST`)
  - Inputs **MUST** be Google push notification headers: `x-goog-channel-id`, `x-goog-resource-id`, `x-goog-channel-token`, `x-goog-resource-state`.
  - Auth **MUST** be channel token validation against `GOOGLE_WEBHOOK_CHANNEL_TOKEN_SECRET` (missing channel → 400, invalid token → 403).
  - Behavior order **MUST** be: resolve userId via `findUserIdByWatchChannel` (unknown → silent `{ok:true}`) -> touch webhook receipt -> if resourceState ≠ `"sync"` trigger delta sync (fallback to inline sync on enqueue failure).
  - Outputs **MUST** be JSON `{ok: true}` or error.

### 6.2 Server Actions (`src/actions/**`)

#### 6.2.1 `auth.ts`

- `signIn(formData)` inputs **MUST** include `email`,`password`; on success **MUST** run sign-in -> profile check -> auto-end lingering pomodoro (`sign_in_auto_end`) -> `revalidatePath("/", "layout")` -> redirect `/dashboard`. (Source: `src/actions/auth.ts::signIn`)
- `signUp(formData)` inputs **MUST** include `email`,`password`; **MUST** call Supabase signup with `emailRedirectTo=${NEXT_PUBLIC_APP_URL}/auth/callback`; returns `{success,message}` or `{error}`. (Source: `src/actions/auth.ts::signUp`)
- `requestPasswordReset(formData)` input **MUST** include `email`; **MUST** use callback redirect to reset mode; returns generic success or `{error}`. (Source: `src/actions/auth.ts::requestPasswordReset`)
- `completePasswordReset(formData)` inputs **MUST** include `password`,`confirmPassword`, enforce length/match, require reset session, then update password + sign out + revalidate. (Source: `src/actions/auth.ts::completePasswordReset`)
- `signOut()` authenticated flow **MUST** auto-end lingering pomo (`sign_out_auto_end`), reset `hide_tips=false` best-effort, sign out, revalidate layout, and redirect hardcoded `https://tas.tarunh.com`. (Source: `src/actions/auth.ts::signOut`)
- `deleteAccount()` **MUST** execute: load proof rows -> delete recurrence_rules where voucher=user -> null task_events.actor_id and rectify_passes.authorized_by -> remove storage proofs -> signOut -> admin delete user. (Source: `src/actions/auth.ts::deleteAccount`)
- `getUser()` **MUST** return current user or null. (Source: `src/actions/auth.ts::getUser`)
- `getProfile()` **MUST** return full profile row or null for unauthenticated. (Source: `src/actions/auth.ts::getProfile`)
- `updateUserDefaults(formData)` **MUST** accept keys `defaultPomoDurationMinutes,defaultFailureCost,defaultVoucherId,deadlineOneHourWarningEnabled,deadlineFinalWarningEnabled,voucherCanViewActiveTasksEnabled,currency,defaultEventDurationMinutes`; enforce all validations (including `defaultEventDurationMinutes` 1..720); update profile; invalidate pending voucher tags and revalidate key paths. (Source: `src/actions/auth.ts::updateUserDefaults`)
- `setDashboardTipsHidden(hidden)` **MUST** update `profiles.hide_tips` for current user and revalidate dashboard/settings. (Source: `src/actions/auth.ts::setDashboardTipsHidden`)
- `updateUsername(formData)` **MUST** validate min length 3, enforce uniqueness, update profile, and revalidate settings. (Source: `src/actions/auth.ts::updateUsername`)

#### 6.2.2 `friends.ts`

- `addFriend(formData)` **MUST** require auth, `email`, reject self/existing, insert reciprocal rows via admin, and revalidate friends/settings/dashboard/new-task paths. (Source: `src/actions/friends.ts::addFriend`)
- `removeFriend(friendId)` **MUST** block when friend is voucher for pending owner task (`CREATED|POSTPONED|MARKED_COMPLETED|AWAITING_VOUCHER`), delete reciprocal rows via admin, and reset default voucher to self when needed. (Source: `src/actions/friends.ts::removeFriend`)
- `getFriends()` **MUST** return current user friend profiles or empty. (Source: `src/actions/friends.ts::getFriends`)
- `getWorkingFriendActivities()` **MUST** derive friend ACTIVE/PAUSED status summary with ACTIVE priority ordering. (Source: `src/actions/friends.ts::getWorkingFriendActivities`)

#### 6.2.3 `ledger.ts`

- `sendLedgerReportEmail()` **MUST** require authenticated user email, load current-period ledger entries, and send report email; returns `{error}` when no entries. (Source: `src/actions/ledger.ts::sendLedgerReportEmail`)

#### 6.2.4 `push.ts`

- `saveSubscription(subscription)` **MUST** require auth (throws if missing), upsert row by `user_id+subscription`, and return `{success,error?}`. (Source: `src/actions/push.ts::saveSubscription`)
- `deleteSubscription(subscription)` **MUST** delete matching user subscription best-effort. (Source: `src/actions/push.ts::deleteSubscription`)

#### 6.2.5 `tasks.ts`

- `createTaskSimple(title,subtasksInput?)` **MUST** require auth, derive defaults from profile, insert `CREATED` task, seed default reminders, insert subtasks, add `CREATED` event, and invalidate/revalidate relevant caches/paths. Event tokens (`-event`, `-start HH:MM`, `-end HH:MM`, color tokens) **MUST** populate `google_sync_for_task` and `google_event_color_id`; `google_event_end_at` is legacy mirrored metadata and `deadline` remains the only due-time source of truth. Event tasks bypass past-deadline validation when event start is in the future. Task state mutations **MUST** enqueue Google Calendar sync via `enqueueGoogleCalendarOutbox` when applicable. (Source: `src/actions/tasks.ts::createTaskSimple`)
- `markTaskCompleted` **MUST** alias `markTaskComplete`. (Source: `src/actions/tasks.ts::markTaskCompleted`)
- `getCachedActiveTasksForUser(userId)` **MUST** return admin-cached active tasks tagged `tasks:active:{userId}` with TTL 60s. (Source: `src/actions/tasks.ts::getCachedActiveTasksForUser`)
- `createTask(formData)` **MUST** validate required inputs, per-currency bounds, reminders, voucher relationship, recurrence payload; then write recurrence/task/reminders/subtasks/events in order and invalidate/revalidate. Event tokens (`-event`, `-start`, `-end`, color tokens) **MUST** be supported with the same semantics as `createTaskSimple`. (Source: `src/actions/tasks.ts::createTask`)
- `cancelRepetition(taskId)` **MUST** delete owner’s recurrence rule referenced by task. (Source: `src/actions/tasks.ts::cancelRepetition`)
- `markTaskComplete(taskId,userTimeZone?)` **MUST** delegate to proof-intent variant. (Source: `src/actions/tasks.ts::markTaskComplete`)
- `markTaskCompleteWithProofIntent(taskId,userTimeZone?,rawProofIntent?)` **MUST** enforce ownership/status/deadline/subtask/pomo preconditions, then:
  - self-vouch -> `COMPLETED`,
  - otherwise -> `AWAITING_VOUCHER` (+optional proof upload session),
  with rollback cleanup on proof-init failures. (Source: `src/actions/tasks.ts::markTaskCompleteWithProofIntent`)
- `initAwaitingVoucherProofUpload(taskId,rawProofIntent)` **MUST** initialize/replace awaiting proof row and return signed upload target. (Source: `src/actions/tasks.ts::initAwaitingVoucherProofUpload`)
- `finalizeTaskProofUpload(taskId,proofMeta)` **MUST** verify proof metadata target match, set `UPLOADED`, clear proof-request flags, and invalidate/revalidate surfaces. (Source: `src/actions/tasks.ts::finalizeTaskProofUpload`)
- `removeAwaitingVoucherProof(taskId)` **MUST** allow only awaiting/marked states, cleanup proof, emit `PROOF_REMOVED`, and revalidate/invalidate. (Source: `src/actions/tasks.ts::removeAwaitingVoucherProof`)
- `revertTaskCompletionAfterProofFailure(taskId)` **MUST** restore awaiting task to active state before deadline with event `PROOF_UPLOAD_FAILED_REVERT`. (Source: `src/actions/tasks.ts::revertTaskCompletionAfterProofFailure`)
- `undoTaskComplete(taskId)` **MUST** restore awaiting task to active state before deadline with event `UNDO_COMPLETE`. (Source: `src/actions/tasks.ts::undoTaskComplete`)
- `addTaskSubtask(parentTaskId,title)` **MUST** enforce owner active parent, non-empty title, and <=20 count. (Source: `src/actions/tasks.ts::addTaskSubtask`)
- `replaceTaskReminders(taskId,remindersIso[])` **MUST** enforce owner active parent, keep past reminders, replace future reminders only, preserve source/created_at when timestamps already exist. (Source: `src/actions/tasks.ts::replaceTaskReminders`)
- `toggleTaskSubtask(parentTaskId,subtaskId,completed)` **MUST** update completion fields only for owner+active parent. (Source: `src/actions/tasks.ts::toggleTaskSubtask`)
- `renameTaskSubtask(parentTaskId,subtaskId,newTitle)` **MUST** enforce non-empty title and owner+active parent. (Source: `src/actions/tasks.ts::renameTaskSubtask`)
- `deleteTaskSubtask(parentTaskId,subtaskId)` **MUST** enforce owner+active parent and return not-found when no deleted row. (Source: `src/actions/tasks.ts::deleteTaskSubtask`)
- `postponeTask(taskId,newDeadlineIso)` **MUST** enforce one-time postpone and future deadlines, update task to `POSTPONED`, realign reminders, and emit `POSTPONE` event. (Source: `src/actions/tasks.ts::postponeTask`)
- `ownerTempDeleteTask(taskId)` **MUST** hard-delete only owner tasks in active statuses within 10-minute window. (Source: `src/actions/tasks.ts::ownerTempDeleteTask`)
- `forceMajeureTask(taskId)` **MUST** enforce failed-only and once-per-period, set `SETTLED`, insert force_majeure + negative ledger + event. (Source: `src/actions/tasks.ts::forceMajeureTask`)
- `getTask(taskId)` **MUST** enforce owner/voucher visibility rules, block voucher active-view unless owner enabled, and may auto-fail overdue active tasks as read-side effect. (Source: `src/actions/tasks.ts::getTask`)
- `getTaskEvents(taskId)` **MUST** return ordered events (RLS-gated). (Source: `src/actions/tasks.ts::getTaskEvents`)
- `getTaskPomoSummary(taskId)` **MUST** enforce task access and return aggregates over non-DELETED sessions. (Source: `src/actions/tasks.ts::getTaskPomoSummary`)
- `startPomoSession(taskId,durationMinutes)` **MUST** require owned task and no existing ACTIVE/PAUSED session. (Source: `src/actions/tasks.ts::startPomoSession`)
- `pausePomoSession(sessionId)` **MUST** require active session and compute elapsed delta. (Source: `src/actions/tasks.ts::pausePomoSession`)
- `resumePomoSession(sessionId)` **MUST** require paused session. (Source: `src/actions/tasks.ts::resumePomoSession`)
- `endPomoSession(sessionId,source?)` **MUST** be idempotent for terminal sessions; non-terminal sessions become `COMPLETED` and log `POMO_COMPLETED` (+timer-complete push). (Source: `src/actions/tasks.ts::endPomoSession`)
- `deletePomoSession(sessionId)` **MUST** set owned session to `DELETED`. (Source: `src/actions/tasks.ts::deletePomoSession`)
- `getActivePomoSession()` **MUST** return `{session,serverNow}` with latest active/paused session or null. (Source: `src/actions/tasks.ts::getActivePomoSession`)

#### 6.2.6 `voucher.ts`

- `voucherAccept(taskId)` **MUST** require voucher auth + valid transition, set `COMPLETED`, cleanup proof, log event, invalidate owner active + voucher pending caches, and revalidate surfaces. (Source: `src/actions/voucher.ts::voucherAccept`)
- `voucherDeleteTask(taskId)` **MUST** soft-delete non-final assigned task, clear proof-request fields, cleanup proof, log event, notify owner, and invalidate/revalidate surfaces. (Source: `src/actions/voucher.ts::voucherDeleteTask`)
- `voucherDeny(taskId)` **MUST** set assigned awaiting task to `FAILED`, cleanup proof, attempt owner failure ledger insert, log event, and notify owner. (Source: `src/actions/voucher.ts::voucherDeny`)
- `voucherRequestProof(taskId)` **MUST** reject self-vouched tasks, require awaiting status, set proof request flags, emit event, notify owner, and refresh caches. (Source: `src/actions/voucher.ts::voucherRequestProof`)
- `authorizeRectify(taskId)` **MUST** require assigned failed task, valid rectify transition, within 7 days, and monthly pass count <5; then set `RECTIFIED`, insert pass, attempt negative ledger entry, and emit event. (Source: `src/actions/voucher.ts::authorizeRectify`)
- `getCachedPendingVouchRequestsForVoucher(voucherId)` **MUST** admin-load pending statuses, filter active visibility by owner flag, enrich pomo/proof/derived-deadline fields, sort, and cache by pending tag. (Source: `src/actions/voucher.ts::getCachedPendingVouchRequestsForVoucher`)
- `getPendingVouchRequests()` **MUST** return current voucher cached pending list. (Source: `src/actions/voucher.ts::getPendingVouchRequests`)
- `getVouchHistoryPage(offset,limit)` **MUST** normalize paging, fetch final-status history page, add timeout-auto-accepted and pass-count enrichments, and return `{tasks,hasMore,nextOffset,error?}`. (Source: `src/actions/voucher.ts::getVouchHistoryPage`)
- `buildProofRequestCountByTaskId` is a pure utility (no `"use server"` boundary) extracted to `src/lib/voucher-proof-request.ts` and imported by `voucher.ts`; it aggregates `PROOF_REQUESTED` task-event rows into a `Map<taskId, count>` used to populate `?N` badges in the voucher UI. (Source: `src/lib/voucher-proof-request.ts`)

#### 6.2.7 `google-calendar.ts`

- `startGoogleCalendarConnect()` **MUST** initiate OAuth flow, set state cookie, and return redirect URL or `{error}`. (Source: `src/actions/google-calendar.ts::startGoogleCalendarConnect`)
- `getGoogleCalendarIntegrationState()` **MUST** return current connection state (connected flag, sync flags, account email, selected calendar, watch/sync timestamps, last error). (Source: `src/actions/google-calendar.ts::getGoogleCalendarIntegrationState`)
- `listGoogleCalendarsForSettings()` **MUST** list available calendars for connected user. (Source: `src/actions/google-calendar.ts::listGoogleCalendarsForSettings`)
- `setGoogleCalendarCalendar(calendarId)` **MUST** select calendar and re-enable Google→App sync if was previously enabled. (Source: `src/actions/google-calendar.ts::setGoogleCalendarCalendar`)
- `setGoogleCalendarAppToGoogleEnabled(enabled)` **MUST** toggle app→Google sync direction. (Source: `src/actions/google-calendar.ts::setGoogleCalendarAppToGoogleEnabled`)
- `setGoogleCalendarGoogleToAppEnabled(enabled)` **MUST** toggle Google→app sync direction. (Source: `src/actions/google-calendar.ts::setGoogleCalendarGoogleToAppEnabled`)
- `setGoogleCalendarSyncEnabled(enabled)` **MUST** toggle both sync directions on/off. (Source: `src/actions/google-calendar.ts::setGoogleCalendarSyncEnabled`)
- `setGoogleCalendarImportTaggedOnly(enabled)` **MUST** toggle import filter for `-event` tagged events only. (Source: `src/actions/google-calendar.ts::setGoogleCalendarImportTaggedOnly`)
- `disconnectGoogleCalendar()` **MUST** revoke Google access, purge all Google integration rows (`google_calendar_connections`, `google_calendar_task_links`, `google_calendar_sync_outbox`). (Source: `src/actions/google-calendar.ts::disconnectGoogleCalendar`)

---

## 7) Background Jobs (Trigger.dev)

- Trigger runtime **MUST** use retry policy from `trigger.config.ts` (`maxAttempts=3`, exponential randomized backoff). (Source: `trigger.config.ts`)

### 7.1 `deadline-fail`

- Schedule **MUST** be `*/5 * * * *`.
- Selection query **MUST** load tasks in `CREATED|POSTPONED` with `deadline < now`.
- Effective due time **MUST** be `deadline` for all task types.
- Algorithm **MUST**:
  1) load overdue active tasks (by `deadline`)
  2) set each to `FAILED`
  3) insert owner `ledger_entries.failure`
  4) insert `task_events.DEADLINE_MISSED`
  5) enqueue Google Calendar outbox for failed event tasks
- Dedupe/idempotency: no global dedupe; concurrent read-path fail logic can duplicate ledger/event rows.
- Source: `src/trigger/deadline-fail.ts`

### 7.2 `voucher-timeout`

- Schedule **MUST** be `0 * * * *`.
- Selection **MUST** target `AWAITING_VOUCHER` where `voucher_response_deadline < now`.
- Algorithm **MUST**:
  1) conditional update to `COMPLETED` (`eq status AWAITING_VOUCHER`)
  2) delete proof
  3) insert voucher penalty ledger row (`voucher_timeout_penalty`, `30` cents)
  4) insert `task_events.VOUCHER_TIMEOUT`
- Dedupe/idempotency: guarded update gives anti-double-run for status mutation; ledger/event still can duplicate on partial failures + retries.
- Source: `src/trigger/voucher-timeout.ts`

### 7.3 `voucher-deadline-warning`

- Schedule **MUST** be `0 9,12,15,18,21 * * *` (UTC).
- Selection **MUST** load `AWAITING_VOUCHER` tasks with future response deadline.
- Algorithm **MUST** aggregate counts per voucher, send one digest, and upsert dedupe log.
- Dedupe logic **MUST** use `voucher_reminder_logs` unique `(voucher_id, reminder_date)`.
- Source: `src/trigger/voucher-deadline-warning.ts`

### 7.4 `task-reminder-notify`

- Schedule **MUST** be `* * * * *`.
- Selection **MUST** load due reminders where `notified_at IS NULL` up to limit 500.
- Algorithm **MUST**:
  1) fetch due reminders
  2) join tasks + owner profiles
  3) for active task statuses only:
     - `MANUAL` source: send email+push
     - default deadline sources: push-only + emit reminder event (`DEADLINE_WARNING_1H` / `DEADLINE_WARNING_5M`)
  4) mark reminder `notified_at` in `finally`
- Retry safety caveat: reminder is marked notified even on send failures; retries do not resend that reminder.
- Source: `src/trigger/task-reminder-notify.ts`

### 7.5 `task-proof-cleanup`

- Schedule **MUST** be `*/5 * * * *`.
- Selection **MUST** scan up to 1000 proof rows with related task status/deadline.
- Cleanup criteria **MUST** include:
  - stale pending upload (`>20 minutes`)
  - voucher response deadline expired
  - task no longer awaiting voucher
  - missing task row
- Action **MUST** call shared delete helper to remove storage object + DB row.
- Source: `src/trigger/task-proof-cleanup.ts`

### 7.6 `recurrence-generator`

- Schedule **MUST** be `0 * * * *`.
- Selection **MUST** load active recurrence rules.
- Core algorithm (as implemented) **MUST** be:
  1) for each active rule, compute current local date in rule timezone
  2) skip when `last_generated_date == current_local_date`
  3) evaluate frequency/interval/day logic to decide `shouldRun`
  4) if due, compute deadline from local date + `time_of_day` using deterministic timezone conversion
  5) insert `tasks.CREATED` with `recurrence_rule_id`; for event rules, populate `google_sync_for_task`, `google_event_color_id`, and keep `google_event_end_at` mirrored to `deadline` for legacy compatibility
  6) insert `task_events.CREATED` (system)
  7) insert manual reminders from template/legacy copy
  8) seed default deadline reminders from owner profile toggles
  9) update `recurrence_rules.last_generated_date`
  10) enqueue Google Calendar outbox for generated event tasks
- Dedupe/idempotency: dedupe is primarily `last_generated_date`; no DB unique guard prevents duplicate task generation under concurrent runs/races.
- Source: `src/trigger/recurrence-generator.ts`

### 7.7 `monthly-settlement`

- Schedule **MUST** be `0 9 1 * *`.
- Selection **MUST** read previous month (`YYYY-MM`) ledger entries for all profiles.
- Behavior **MUST**:
  - if total > 0: send settlement email with breakdown + CTA
  - if total == 0 and entries exist: send “perfect month” email
- Idempotency: no dedupe; reruns can resend emails.
- Source: `src/trigger/ledger-settlement.ts`

### 7.8 `google-calendar-dispatch`

- Type: on-demand task (not scheduled).
- Trigger: invoked with `{outboxId}` payload.
- Algorithm **MUST** process individual outbox item via `processGoogleCalendarOutboxItem`.
- Source: `src/trigger/google-calendar-sync.ts`

### 7.9 `google-calendar-sync-connection`

- Type: on-demand task (not scheduled).
- Trigger: invoked with `{userId, reason?}` payload.
- Algorithm **MUST** run full delta sync for a user via `processGoogleCalendarDeltaForUser`.
- Source: `src/trigger/google-calendar-sync.ts`

### 7.10 `google-calendar-sync-sweeper`

- Schedule **MUST** be `* * * * *` (every minute).
- Algorithm **MUST**:
  1) sync enabled connections (up to 200 per run)
  2) retry pending outbox items (up to 200 per run)
  3) reconcile stale connections
- Source: `src/trigger/google-calendar-sync.ts`

### 7.11 `google-calendar-watch-renew`

- Schedule **MUST** be `0 * * * *` (hourly).
- Algorithm **MUST** renew expiring Google Calendar webhook watch subscriptions via `renewExpiringGoogleCalendarWatches`.
- Source: `src/trigger/google-calendar-sync.ts`

---

## 8) Realtime + Caching Semantics

### 8.1 Realtime Subscriptions (Supabase channels + filters)

- The app **MUST** subscribe to `tasks` changes on channel `realtime:tasks` with two filters: `voucher_id=eq.{userId}` and `user_id=eq.{userId}`. (Source: `src/components/RealtimeListener.tsx::RealtimeListener`)
- The app **MUST** subscribe to `friendships` changes on channel `realtime:friendships` and only react when the changed row includes current user as either `user_id` or `friend_id`. (Source: `src/components/RealtimeListener.tsx::RealtimeListener`)
- The app **MUST** subscribe to `pomo_sessions` on channel `realtime:pomo_sessions` and only refresh when changed rows belong to known friends (excluding current user). (Source: `src/components/RealtimeListener.tsx::RealtimeListener`)
- The pomodoro provider **MUST** subscribe to user-scoped channel `realtime:pomo_sessions:{userId}` with filter `user_id=eq.{userId}` and refresh active session snapshot on each change. (Source: `src/components/PomodoroProvider.tsx::PomodoroProvider`)
- The client **MUST** emit and consume local browser event `vouch:realtime-task-change` to patch task lists before/alongside server refresh. (Source: `src/lib/realtime-task-events.ts::{emitRealtimeTaskChange,subscribeRealtimeTaskChanges}`, `src/app/dashboard/*client.tsx`)

### 8.2 Refresh cadence, throttling, reconciliation

- On realtime task updates, client refresh scheduling **MUST** use:
  - fast throttle `300ms`,
  - reconcile throttle `1200ms` for `UPDATE` events on patch-enabled pages.
  (Source: `src/components/RealtimeListener.tsx::{FAST_REFRESH_THROTTLE_MS,RECONCILIATION_REFRESH_MS,scheduleRefresh}`)
- Realtime payloads **MUST** be patched into local task state only when incoming `updated_at` is newer/equal than local row (`incoming >= local`). (Source: `src/lib/tasks-realtime-patch.ts::isIncomingNewer`, `src/app/dashboard/*client.tsx`)
- Client state reconciliation caveat **MUST** be preserved: `router.refresh()` updates server props, but local state initialized from props may diverge; local components must explicitly resync local copies from incoming props. (Source: `src/app/dashboard/tasks/[id]/task-detail-client.tsx` explanatory block + `useEffect` sync)
- Local-only draft state (proof draft inputs, pending flags, dialog state) **MAY** remain unsynced across realtime refresh and is intentionally preserved in some screens. (Source: `src/app/dashboard/tasks/[id]/task-detail-client.tsx`, `src/app/dashboard/dashboard-client.tsx`)

### 8.3 Cache tags and invalidation contracts

- `getCachedActiveTasksForUser` **MUST** cache with tag `tasks:active:{userId}` and TTL 60s; owner-visible task mutations **MUST** invalidate that tag. (Source: `src/actions/tasks.ts::{getCachedActiveTasksForUser,invalidateActiveTasksCache}`, `src/lib/cache-tags.ts::activeTasksTag`)
- Voucher pending list loader **MUST** cache on tag `voucher:pending:{voucherId}` with TTL 300s; voucher/owner mutations that change pending visibility **MUST** invalidate this tag. (Source: `src/actions/voucher.ts::{getCachedPendingVouchRequestsForVoucher,invalidatePendingVoucherRequestsCache}`, `src/lib/cache-tags.ts::pendingVoucherRequestsTag`)
- Mutation handlers **MUST** revalidate key paths (`/dashboard`, `/dashboard/friends`, `/dashboard/stats`, `/dashboard/tasks/[id]`, `/dashboard/settings`, `/dashboard/ledger`, `/dashboard/tasks/new`) according to touched domain. (Source: `src/actions/{tasks,voucher,auth,friends}.ts`)

### 8.4 Service worker/browser cache semantics

- Service worker **MUST** bypass cache for `/api/*` and non-GET requests; proof and mutation APIs are therefore network-only at SW layer. (Source: `public/sw.js::shouldBypass`)
- Static assets **MUST** use stale-while-revalidate cache; page/RSC navigations **MUST** use network-first with page cache fallback. (Source: `public/sw.js::{staleWhileRevalidate,networkFirst,fetch listener}`)
- Proof media purge behavior **MUST** delete local warmed object URLs and browser cache entries for `/api/task-proofs/{taskId}` when proof is replaced/removed/reverted. (Source: `src/lib/proof-media-warmup.ts::{purgeLocalProofMedia,invalidateWarmProofForTask}`)

### 8.5 User-observable consistency target

- Under normal network conditions, writes by actor A (owner/voucher/system) **SHOULD** appear on actor B dashboard surfaces within ~0.3s to ~2s (realtime event delivery + refresh throttle + server render). (Source: `src/components/RealtimeListener.tsx`, `src/app/dashboard/*client.tsx`)
- In degraded conditions (offline tab, dropped socket, browser background throttling), visibility **MAY** lag until focus/poll/manual refresh; voucher dashboard fallback poll is 60s. (Source: `src/app/dashboard/voucher/voucher-dashboard-client.tsx::PENDING_FALLBACK_POLL_MS`, `src/components/PomodoroProvider.tsx` focus/visibility refresh)

---

## 9) Edge-Case Catalog (Concrete Runtime Rules)

### 9.1 Numeric bounds and quotas

- Task `failure_cost_cents` DB constraint **MUST** be `1..100000`; profile default failure cost DB constraint **MUST** also be `1..100000`. (Source: `supabase/migrations/030_per_currency_failure_cost_bounds.sql`)
- App-level owner currency bounds **MUST** be:
  - `EUR`/`USD`: `1.00..100.00` major units (`100..10000` cents),
  - `INR`: `50..1000` major units (`5000..100000` cents).
  (Source: `src/lib/currency.ts::getFailureCostBounds`, `src/actions/tasks.ts::createTask`, `src/actions/auth.ts::updateUserDefaults`)
- `default_pomo_duration_minutes` **MUST** be integer `1..720`. (Source: `supabase/migrations/009_profile_defaults.sql`, `src/actions/auth.ts::updateUserDefaults`)
- `required_pomo_minutes` on task/rule **MUST** be null or `1..10000`. (Source: `supabase/migrations/018_add_required_pomo_minutes.sql`, `src/actions/tasks.ts`)
- Task proof constraints **MUST** be: max 5MB, video max 15000ms, `media_kind in (image,video)`, `upload_state in (PENDING,UPLOADED,FAILED)`. (Source: `supabase/migrations/016_task_completion_proofs.sql`, `src/lib/task-proof-shared.ts`)
- Subtasks per parent task **MUST NOT** exceed 20 (DB trigger + app checks). (Source: `supabase/migrations/011_task_subtasks.sql::enforce_task_subtask_limit`, `src/actions/tasks.ts`)
- `default_event_duration_minutes` **MUST** be integer `1..720`. (Source: `supabase/migrations/039_profile_default_event_duration.sql`)
- `google_event_color_id` **MUST** be NULL or `'1'..'11'`. (Source: `supabase/migrations/042_google_event_color_id.sql`)
- Rectify usage **MUST** cap at 5 per owner per period; force majeure **MUST** cap at 1 per owner per period. (Source: `src/actions/voucher.ts::authorizeRectify`, `src/actions/tasks.ts::forceMajeureTask`)
- Voucher timeout penalty **MUST** be `30` cents per timed-out task. (Source: `src/trigger/voucher-timeout.ts::VOUCHER_TIMEOUT_PENALTY_CENTS`)

### 9.2 Time windows and schedule boundaries

- Owner temporary hard delete window **MUST** be 10 minutes from `tasks.created_at`. (Source: `src/lib/task-delete-window.ts::OWNER_TEMP_DELETE_WINDOW_MS`, `src/actions/tasks.ts::ownerTempDeleteTask`)
- Voucher response deadline **MUST** be computed as end-of-day local time approximately +2 local days from completion mark (timezone-aware helper). (Source: `src/actions/tasks.ts::getVoucherResponseDeadlineUtc`)
- Voucher timeout job **MUST** evaluate overdue awaiting tasks hourly (`0 * * * *`). (Source: `src/trigger/voucher-timeout.ts`)
- Deadline fail job **MUST** evaluate overdue active tasks every 5 minutes. (Source: `src/trigger/deadline-fail.ts`)
- Rectify window **MUST** expire after 7 days from failed task `updated_at`. (Source: `src/actions/voucher.ts::RECTIFY_WINDOW_MS`)
- Stale pending proof uploads **MUST** be cleanup-eligible after 20 minutes. (Source: `src/trigger/task-proof-cleanup.ts::STALE_PENDING_UPLOAD_MS`)
- Reminder dispatcher **MUST** process up to 500 due reminders per run (per minute schedule). (Source: `src/trigger/task-reminder-notify.ts`)
- Google Calendar watch subscriptions expire after ~7 days; renewed hourly by `google-calendar-watch-renew`. (Source: `src/trigger/google-calendar-sync.ts`)
- Stale outbox items **MUST** be retried with exponential backoff by sweeper. (Source: `src/trigger/google-calendar-sync.ts`)

### 9.3 “Only once” and dedupe semantics

- Postpone action **MUST** be allowed once per task (`postponed_at` guard + status check). (Source: `src/actions/tasks.ts::postponeTask`)
- Recurrence generation dedupe **MUST** primarily rely on `last_generated_date`; no hard DB unique key prevents duplicate generated tasks under concurrent runs. (Source: `src/trigger/recurrence-generator.ts::processRule`)
- Voucher reminder digest dedupe **MUST** use unique `(voucher_id, reminder_date)` in `voucher_reminder_logs`. (Source: `supabase/migrations/010_voucher_review_policy.sql`, `src/trigger/voucher-deadline-warning.ts`)
- Pomodoro active/paused concurrency **MUST** be DB-enforced for `status IN ('ACTIVE','PAUSED')` via partial unique index `idx_single_active_or_paused_pomo`. (Source: `supabase/migrations/041_pomo_sessions_single_active_or_paused.sql`, `src/actions/tasks.ts::startPomoSession`)

### 9.4 Self-vouch, visibility, and policy quirks

- Self-vouched completion **MUST** bypass awaiting-voucher and move directly to `COMPLETED`; proof request flow is not supported for self-vouch. (Source: `src/actions/tasks.ts::markTaskCompleteWithProofIntent`, `src/actions/voucher.ts::voucherRequestProof`)
- Voucher pending/history queries **MUST** exclude self-vouch tasks (`user_id != voucher_id`). (Source: `src/actions/voucher.ts::{getCachedPendingVouchRequestsForVoucher,getVouchHistoryPage}`)
- Voucher visibility for owner active tasks **MUST** depend on owner profile toggle `voucher_can_view_active_tasks`; DB RLS may permit broader row visibility, but app read-path filters are runtime truth for product behavior. (Source: `src/actions/tasks.ts::{getTask,getTaskPomoSummary}`, `src/actions/voucher.ts::canVoucherSeeTask`, `supabase/migrations/023_profile_voucher_active_task_visibility.sql`)
- Friend activity visibility **MUST** include only friends and only active/paused sessions via RLS policy. (Source: `supabase/migrations/020_friend_read_pomo_sessions.sql`, `src/actions/friends.ts::getWorkingFriendActivities`)
- Event tasks with `-event` tag **MAY** be imported from Google Calendar; `import_only_tagged_google_events` toggle controls whether only `-event`-tagged events are imported. (Source: `src/actions/google-calendar.ts::setGoogleCalendarImportTaggedOnly`)
- Color tokens **MUST** only be valid for event tasks; non-event tasks with color tokens **MUST** produce validation error. (Source: `src/actions/tasks.ts`)

### 9.5 FK deletion consequences and missing dependency behavior

- Deleting a profile/user **MUST** cascade-delete most owned rows (`tasks`, `friendships`, `ledger_entries`, `force_majeure`, `pomo_sessions`, reminders/subtasks/proofs via task cascade). (Source: migrations `001`, `015`, `016`, `011`, `008`)
- `recurrence_rules.voucher_id` **MUST** cascade on voucher profile delete; `rectify_passes.authorized_by` **MUST** set null. (Source: `supabase/migrations/029_account_delete_fk_fixes.sql`)
- `task_events.actor_id` FK delete action is restrictive (no action); account deletion flow **MUST** null actor IDs before deleting auth user. (Source: `supabase/migrations/001_initial_schema.sql`, `src/actions/auth.ts::deleteAccount`)
- Proof fetch API **MUST** return:
  - `404` for missing task/proof,
  - `410` for expired/non-awaiting proof windows,
  - `403` for cross-site/invalid destination hardening failures.
  (Source: `src/app/api/task-proofs/[taskId]/route.ts::GET`)

### 9.6 Legacy vs template reminder behavior

- Recurrence rule with `manual_reminder_offsets_ms IS NULL` **MUST** use legacy derivation from latest generated task manual reminders.
- Recurrence rule with `manual_reminder_offsets_ms` array (including empty array) **MUST** use template mode from stored offsets.
- Task creation with recurrence **MUST** persist `manual_reminder_offsets_ms` derived from initial manual reminders to avoid legacy fallback for new rules.
  (Source: `supabase/migrations/028_recurrence_manual_reminder_template.sql`, `src/trigger/recurrence-generator.ts::{getReminderOffsetsForRule,getLatestReminderOffsetsForRule}`, `src/actions/tasks.ts::createTask`)

### 9.7 Concurrency and retry caveats to preserve

- `getTask` read-side auto-fail and `deadline-fail` cron can both fail same overdue task; duplicate ledger/event inserts are possible because no unique dedupe keys exist. (Source: `src/actions/tasks.ts::getTask`, `src/trigger/deadline-fail.ts`)
- `voucherAccept`/`voucherDeny` updates are not fully conditional on old status at SQL level; repeated calls can race and may duplicate side-effects. (Source: `src/actions/voucher.ts`)
- `task-reminder-notify` marks reminders `notified_at` in `finally`; notification send failure can still suppress retry for that reminder. (Source: `src/trigger/task-reminder-notify.ts`)

---

## 10) Coverage Matrix (Zero-undocumented artifacts)

### 10.1 Migrations

| Artifact | Type | Covered in sections |
|---|---|---|
| `supabase/migrations/001_initial_schema.sql` | migration | `3`, `3.2`, `3.4`, `5`, `9` |
| `supabase/migrations/002_make_actor_id_nullable.sql` | migration | `3.2.4`, `3.4`, `9.5` |
| `supabase/migrations/002_voucher_delete_task.sql` | migration | `3.2.3`, `5.1.2`, `6.2.6` |
| `supabase/migrations/003_add_deleted_status.sql` | migration | `3.2.3`, `5.1.1` |
| `supabase/migrations/004_remove_active_status.sql` | migration | `3.2.3`, `5.1.1` |
| `supabase/migrations/005_web_push_subscriptions.sql` | migration | `3.2.8`, `6.2.4`, `2` |
| `supabase/migrations/006_enable_realtime.sql` | migration | `3.5`, `8.1` |
| `supabase/migrations/007_add_recurrence.sql` | migration | `3.2.9`, `5`, `7.6` |
| `supabase/migrations/008_pomo_sessions.sql` | migration | `3.2.10`, `5.2`, `6.2.5`, `9.3` |
| `supabase/migrations/009_profile_defaults.sql` | migration | `3.2.1`, `6.2.1`, `9.1` |
| `supabase/migrations/010_voucher_review_policy.sql` | migration | `3.2.5`, `3.2.11`, `7.3`, `9.3` |
| `supabase/migrations/011_task_subtasks.sql` | migration | `3.2.12`, `6.2.5`, `9.1` |
| `supabase/migrations/012_profile_hide_tips.sql` | migration | `3.2.1`, `6.2.1` |
| `supabase/migrations/013_enable_realtime_pomo_sessions.sql` | migration | `3.5`, `8.1` |
| `supabase/migrations/014_ensure_realtime_tasks_friendships.sql` | migration | `3.5`, `8.1` |
| `supabase/migrations/015_task_reminders.sql` | migration | `3.2.13`, `6.2.5`, `7.4` |
| `supabase/migrations/016_task_completion_proofs.sql` | migration | `3.2.14`, `3.3`, `5.3`, `6.1`, `7.5` |
| `supabase/migrations/017_task_proofs_allow_image_jpg.sql` | migration | `3.3`, `5.3` |
| `supabase/migrations/018_add_required_pomo_minutes.sql` | migration | `3.2.3`, `3.2.9`, `6.2.5`, `9.1` |
| `supabase/migrations/019_add_strict_pomo_mode.sql` | migration | `3.2.1`, `3.2.10`, `5.2`, `6.2.5` |
| `supabase/migrations/020_friend_read_pomo_sessions.sql` | migration | `3.2.10`, `8.1`, `9.4` |
| `supabase/migrations/021_add_profile_deadline_final_warning.sql` | migration | `3.2.1`, `6.2.1`, `7.4` |
| `supabase/migrations/022_profile_currency_and_one_hour_warning.sql` | migration | `3.2.1`, `6.2.1`, `9.1` |
| `supabase/migrations/023_profile_voucher_active_task_visibility.sql` | migration | `3.2.1`, `6.2.1`, `9.4` |
| `supabase/migrations/024_default_self_voucher.sql` | migration | `3.2.1`, `3.4`, `6.2.1` |
| `supabase/migrations/025_task_reminder_sources_and_default_seed.sql` | migration | `3.2.13`, `6.2.5`, `7.4`, `9.6` |
| `supabase/migrations/026_task_reminders_timestamp_defaults.sql` | migration | `3.2.13` |
| `supabase/migrations/027_task_proof_request_flags.sql` | migration | `3.2.3`, `6.2.6`, `9.4` |
| `supabase/migrations/028_recurrence_manual_reminder_template.sql` | migration | `3.2.9`, `7.6`, `9.6` |
| `supabase/migrations/029_account_delete_fk_fixes.sql` | migration | `3.2.6`, `3.2.9`, `6.2.1`, `9.5` |
| `supabase/migrations/030_per_currency_failure_cost_bounds.sql` | migration | `3.2.1`, `3.2.3`, `6.2.1`, `9.1` |
| `supabase/migrations/031_harden_task_completion_proofs_integrity.sql` | migration | `3.2.14`, `3.4` |
| `supabase/migrations/032_google_calendar_sync.sql` | migration | `3.2.15`, `3.2.16`, `3.2.17` |
| `supabase/migrations/033_enable_realtime_google_calendar_outbox.sql` | migration | `3.2.17`, `3.5` |
| `supabase/migrations/034_google_tasks_default_sync_kind.sql` | migration | `3.2.16` |
| `supabase/migrations/035_google_tasks_sync_cursor.sql` | migration | `3.2.15` |
| `supabase/migrations/036_add_google_event_end_time_columns.sql` | migration | `3.2.3`, `3.2.9` |
| `supabase/migrations/037_google_sync_boolean_flags.sql` | migration | `3.2.3`, `3.2.9`, `3.2.15`, `3.2.16` |
| `supabase/migrations/038_google_calendar_import_filter_toggle.sql` | migration | `3.2.15` |
| `supabase/migrations/039_profile_default_event_duration.sql` | migration | `3.2.1`, `6.2.1`, `9.1` |
| `supabase/migrations/040_google_calendar_directional_sync_flags.sql` | migration | `3.2.15` |
| `supabase/migrations/041_pomo_sessions_single_active_or_paused.sql` | migration | `3.2.10`, `5.2`, `9.3` |
| `supabase/migrations/042_google_event_color_id.sql` | migration | `3.2.3`, `3.2.9`, `9.1` |

### 10.2 Tables

| Table | Covered in sections |
|---|---|
| `profiles` | `3.2.1`, `6.2.1`, `9.1` |
| `friendships` | `3.2.2`, `6.2.2`, `8.1` |
| `tasks` | `3.2.3`, `5.1`, `6.2.5`, `9` |
| `task_events` | `3.2.4`, `5`, `6`, `7` |
| `ledger_entries` | `3.2.5`, `5`, `6.2.3`, `7`, `9` |
| `rectify_passes` | `3.2.6`, `5.1.2`, `6.2.6`, `9` |
| `force_majeure` | `3.2.7`, `5.1.2`, `6.2.5`, `9` |
| `web_push_subscriptions` | `3.2.8`, `6.2.4`, `2` |
| `recurrence_rules` | `3.2.9`, `6.2.5`, `7.6`, `9.6` |
| `pomo_sessions` | `3.2.10`, `5.2`, `6.2.5`, `8.1` |
| `voucher_reminder_logs` | `3.2.11`, `7.3`, `9.3` |
| `task_subtasks` | `3.2.12`, `6.2.5`, `9.1` |
| `task_reminders` | `3.2.13`, `6.2.5`, `7.4`, `9.6` |
| `task_completion_proofs` | `3.2.14`, `3.3`, `5.3`, `6.1`, `7.5` |
| `google_calendar_connections` | `3.2.15`, `6.2.7`, `7.10`, `7.11` |
| `google_calendar_task_links` | `3.2.16`, `6.2.7` |
| `google_calendar_sync_outbox` | `3.2.17`, `3.5`, `6.2.7`, `7.8`, `7.10` |

### 10.3 Routes (pages + API/auth handlers)

| Artifact | Type | Covered in sections |
|---|---|---|
| `src/app/page.tsx` | page | `1`, `6`, `11` |
| `src/app/login/page.tsx` | page | `6.2.1`, `11` |
| `src/app/dashboard/page.tsx` | page | `1`, `8.3` |
| `src/app/dashboard/friends/page.tsx` | page | `6.2.6`, `8` |
| `src/app/dashboard/ledger/page.tsx` | page | `6.2.3`, `9` |
| `src/app/dashboard/settings/page.tsx` | page | `6.2.1` |
| `src/app/dashboard/stats/page.tsx` | page | `8`, `9` |
| `src/app/dashboard/tasks/new/page.tsx` | page | `6.2.5`, `9.1` |
| `src/app/dashboard/tasks/[id]/page.tsx` | page | `6.2.5`, `8.2` |
| `src/app/dashboard/voucher/page.tsx` | page | `6`, `11` |
| `src/app/auth/callback/route.ts` | route | `6.1` |
| `src/app/api/pomo/auto-end/route.ts` | route | `6.1`, `11` |
| `src/app/api/task-proofs/[taskId]/route.ts` | route | `6.1`, `3.3`, `9.5` |
| `src/app/api/integrations/google/callback/route.ts` | route | `6.1` |
| `src/app/api/integrations/google/webhook/route.ts` | route | `6.1` |

### 10.4 Server action exports

| Export | Source | Covered in sections |
|---|---|---|
| `signIn` | `src/actions/auth.ts` | `6.2.1` |
| `signUp` | `src/actions/auth.ts` | `6.2.1` |
| `requestPasswordReset` | `src/actions/auth.ts` | `6.2.1` |
| `completePasswordReset` | `src/actions/auth.ts` | `6.2.1` |
| `signOut` | `src/actions/auth.ts` | `6.2.1` |
| `deleteAccount` | `src/actions/auth.ts` | `6.2.1`, `9.5` |
| `getUser` | `src/actions/auth.ts` | `6.2.1` |
| `getProfile` | `src/actions/auth.ts` | `6.2.1` |
| `updateUserDefaults` | `src/actions/auth.ts` | `6.2.1`, `9.1` |
| `setDashboardTipsHidden` | `src/actions/auth.ts` | `6.2.1` |
| `updateUsername` | `src/actions/auth.ts` | `6.2.1` |
| `addFriend` | `src/actions/friends.ts` | `6.2.2` |
| `removeFriend` | `src/actions/friends.ts` | `6.2.2`, `9.4` |
| `getFriends` | `src/actions/friends.ts` | `6.2.2` |
| `getWorkingFriendActivities` | `src/actions/friends.ts` | `6.2.2`, `9.4` |
| `sendLedgerReportEmail` | `src/actions/ledger.ts` | `6.2.3` |
| `saveSubscription` | `src/actions/push.ts` | `6.2.4` |
| `deleteSubscription` | `src/actions/push.ts` | `6.2.4` |
| `createTaskSimple` | `src/actions/tasks.ts` | `6.2.5`, `5.1.2` |
| `markTaskCompleted` | `src/actions/tasks.ts` | `6.2.5` |
| `getCachedActiveTasksForUser` | `src/actions/tasks.ts` | `6.2.5`, `8.3` |
| `createTask` | `src/actions/tasks.ts` | `6.2.5`, `9.1`, `9.6` |
| `cancelRepetition` | `src/actions/tasks.ts` | `6.2.5`, `9.5` |
| `markTaskComplete` | `src/actions/tasks.ts` | `6.2.5`, `5.1.2` |
| `markTaskCompleteWithProofIntent` | `src/actions/tasks.ts` | `6.2.5`, `5.1.2`, `5.3` |
| `initAwaitingVoucherProofUpload` | `src/actions/tasks.ts` | `6.2.5`, `5.3` |
| `finalizeTaskProofUpload` | `src/actions/tasks.ts` | `6.2.5`, `5.3` |
| `removeAwaitingVoucherProof` | `src/actions/tasks.ts` | `6.2.5`, `5.3` |
| `revertTaskCompletionAfterProofFailure` | `src/actions/tasks.ts` | `6.2.5`, `5.1.2` |
| `undoTaskComplete` | `src/actions/tasks.ts` | `6.2.5`, `5.1.2` |
| `addTaskSubtask` | `src/actions/tasks.ts` | `6.2.5`, `9.1` |
| `replaceTaskReminders` | `src/actions/tasks.ts` | `6.2.5`, `9.6` |
| `toggleTaskSubtask` | `src/actions/tasks.ts` | `6.2.5` |
| `renameTaskSubtask` | `src/actions/tasks.ts` | `6.2.5` |
| `deleteTaskSubtask` | `src/actions/tasks.ts` | `6.2.5` |
| `postponeTask` | `src/actions/tasks.ts` | `6.2.5`, `5.1.2`, `9.3` |
| `ownerTempDeleteTask` | `src/actions/tasks.ts` | `6.2.5`, `5.1.2`, `9.2` |
| `forceMajeureTask` | `src/actions/tasks.ts` | `6.2.5`, `5.1.2`, `9.1` |
| `getTask` | `src/actions/tasks.ts` | `6.2.5`, `5.1.2`, `9.4`, `9.7` |
| `getTaskEvents` | `src/actions/tasks.ts` | `6.2.5` |
| `getTaskPomoSummary` | `src/actions/tasks.ts` | `6.2.5`, `9.4` |
| `startPomoSession` | `src/actions/tasks.ts` | `6.2.5`, `5.2` |
| `pausePomoSession` | `src/actions/tasks.ts` | `6.2.5`, `5.2` |
| `resumePomoSession` | `src/actions/tasks.ts` | `6.2.5`, `5.2` |
| `endPomoSession` | `src/actions/tasks.ts` | `6.2.5`, `5.2` |
| `deletePomoSession` | `src/actions/tasks.ts` | `6.2.5`, `5.2` |
| `getActivePomoSession` | `src/actions/tasks.ts` | `6.2.5`, `8.1` |
| `voucherAccept` | `src/actions/voucher.ts` | `6.2.6`, `5.1.2` |
| `voucherDeleteTask` | `src/actions/voucher.ts` | `6.2.6`, `5.1.2` |
| `voucherDeny` | `src/actions/voucher.ts` | `6.2.6`, `5.1.2`, `9.7` |
| `voucherRequestProof` | `src/actions/voucher.ts` | `6.2.6`, `5.3`, `9.4` |
| `authorizeRectify` | `src/actions/voucher.ts` | `6.2.6`, `5.1.2`, `9.2` |
| `getCachedPendingVouchRequestsForVoucher` | `src/actions/voucher.ts` | `6.2.6`, `8.3` |
| `getPendingVouchRequests` | `src/actions/voucher.ts` | `6.2.6` |
| `getVouchHistoryPage` | `src/actions/voucher.ts` | `6.2.6` |
| `startGoogleCalendarConnect` | `src/actions/google-calendar.ts` | `6.2.7` |
| `getGoogleCalendarIntegrationState` | `src/actions/google-calendar.ts` | `6.2.7` |
| `listGoogleCalendarsForSettings` | `src/actions/google-calendar.ts` | `6.2.7` |
| `setGoogleCalendarCalendar` | `src/actions/google-calendar.ts` | `6.2.7` |
| `setGoogleCalendarAppToGoogleEnabled` | `src/actions/google-calendar.ts` | `6.2.7` |
| `setGoogleCalendarGoogleToAppEnabled` | `src/actions/google-calendar.ts` | `6.2.7` |
| `setGoogleCalendarSyncEnabled` | `src/actions/google-calendar.ts` | `6.2.7` |
| `setGoogleCalendarImportTaggedOnly` | `src/actions/google-calendar.ts` | `6.2.7` |
| `disconnectGoogleCalendar` | `src/actions/google-calendar.ts` | `6.2.7` |

### 10.5 Trigger jobs

| Job ID | Source | Covered in sections |
|---|---|---|
| `deadline-fail` | `src/trigger/deadline-fail.ts` | `7.1`, `5.1.2`, `9.7` |
| `voucher-timeout` | `src/trigger/voucher-timeout.ts` | `7.2`, `5.1.2`, `9.2` |
| `voucher-deadline-warning` | `src/trigger/voucher-deadline-warning.ts` | `7.3`, `9.3` |
| `task-reminder-notify` | `src/trigger/task-reminder-notify.ts` | `7.4`, `9.7` |
| `task-proof-cleanup` | `src/trigger/task-proof-cleanup.ts` | `7.5`, `5.3`, `9.2` |
| `recurrence-generator` | `src/trigger/recurrence-generator.ts` | `7.6`, `9.6` |
| `monthly-settlement` | `src/trigger/ledger-settlement.ts` | `7.7`, `11` |
| `google-calendar-dispatch` | `src/trigger/google-calendar-sync.ts` | `7.8` |
| `google-calendar-sync-connection` | `src/trigger/google-calendar-sync.ts` | `7.9` |
| `google-calendar-sync-sweeper` | `src/trigger/google-calendar-sync.ts` | `7.10` |
| `google-calendar-watch-renew` | `src/trigger/google-calendar-sync.ts` | `7.11` |

### 10.6 Realtime channels/subscriptions

| Channel/Event | Source | Covered in sections |
|---|---|---|
| `realtime:tasks` | `src/components/RealtimeListener.tsx` | `8.1` |
| `realtime:friendships` | `src/components/RealtimeListener.tsx` | `8.1` |
| `realtime:pomo_sessions` | `src/components/RealtimeListener.tsx` | `8.1` |
| `realtime:pomo_sessions:{userId}` | `src/components/PomodoroProvider.tsx` | `8.1` |
| `vouch:realtime-task-change` | `src/lib/realtime-task-events.ts` | `8.1`, `8.2` |
| `google_calendar_sync_outbox` (publication) | `supabase/migrations/033` | `3.5` |

### 10.7 Lib utilities

| Export | Source | Covered in sections |
|---|---|---|
| `buildProofRequestCountByTaskId` | `src/lib/voucher-proof-request.ts` | `6.2.6` |

---

## 11) Known Unknowns (Do Not Infer)

- The repository contains no implemented charity payment/debit execution path; monthly settlement only sends notifications/emails, so real payment processor contract is unknown. (Source: `src/trigger/ledger-settlement.ts`, `src/app/dashboard/settings/settings-client.tsx` “Coming soon”)
- Trigger.dev platform secrets/transport settings (for task execution in each environment) are external to repo code and cannot be proven here. (Source: `trigger.config.ts`)
- `/api/pomo/auto-end` has no in-repo caller; whether it is invoked by external script/browser unload integration is unknown from this repository alone. (Source: repo search + `src/app/api/pomo/auto-end/route.ts`)
- Production domain and redirect policies beyond hardcoded usages (`https://tas.tarunh.com`, `NEXT_PUBLIC_APP_URL`) are operational configuration and not fully derivable from code.
