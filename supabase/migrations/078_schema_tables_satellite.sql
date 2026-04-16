--
-- 078: Satellite tables — task_events, subtasks, reminders, proofs, pomo, ai_vouches,
--      ledger, overrides, rectify_passes, google calendar, voucher reminders, web push
--

-- ============================================
-- TASK EVENTS (immutable audit log)
-- ============================================
CREATE TABLE public.task_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_id UUID REFERENCES public.profiles(id),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT task_events_event_type_check
    CHECK (event_type = ANY (ARRAY[
      'ACTIVE','MARK_COMPLETE','UNDO_COMPLETE',
      'PROOF_UPLOADED','PROOF_UPLOAD_FAILED_REVERT','PROOF_REMOVED','PROOF_REQUESTED',
      'VOUCHER_ACCEPT','VOUCHER_DENY','VOUCHER_DELETE',
      'RECTIFY','OVERRIDE','DEADLINE_MISSED','VOUCHER_TIMEOUT',
      'POMO_COMPLETED','DEADLINE_WARNING_1H','DEADLINE_WARNING_5M',
      'GOOGLE_EVENT_CANCELLED','POSTPONE',
      'AI_APPROVE','AI_DENY','AI_DENIED_AUTO_HOP',
      'ESCALATE','AI_ESCALATE_TO_HUMAN','ACCEPT_DENIAL'
    ])) NOT VALID,
  CONSTRAINT task_events_from_status_check
    CHECK (from_status = ANY (ARRAY[
      'ACTIVE','POSTPONED','MARKED_COMPLETE','AWAITING_VOUCHER',
      'AWAITING_AI','AI_DENIED','AWAITING_USER','ESCALATED',
      'ACCEPTED','AUTO_ACCEPTED','AI_ACCEPTED',
      'DENIED','MISSED','RECTIFIED','SETTLED','DELETED'
    ])),
  CONSTRAINT task_events_to_status_check
    CHECK (to_status = ANY (ARRAY[
      'ACTIVE','POSTPONED','MARKED_COMPLETE','AWAITING_VOUCHER',
      'AWAITING_AI','AI_DENIED','AWAITING_USER','ESCALATED',
      'ACCEPTED','AUTO_ACCEPTED','AI_ACCEPTED',
      'DENIED','MISSED','RECTIFIED','SETTLED','DELETED'
    ]))
);

-- ============================================
-- TASK SUBTASKS
-- ============================================
CREATE TABLE public.task_subtasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT task_subtasks_title_not_blank CHECK (char_length(btrim(title)) > 0)
);

-- ============================================
-- TASK REMINDERS
-- ============================================
CREATE TABLE public.task_reminders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reminder_at TIMESTAMPTZ NOT NULL,
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'MANUAL'::text,

  CONSTRAINT task_reminders_parent_task_id_reminder_at_key
    UNIQUE (parent_task_id, reminder_at),
  CONSTRAINT task_reminders_source_check
    CHECK (source = ANY (ARRAY['MANUAL','DEFAULT_DEADLINE_1H','DEFAULT_DEADLINE_5M']))
);

-- ============================================
-- TASK COMPLETION PROOFS
-- ============================================
CREATE TABLE public.task_completion_proofs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL UNIQUE REFERENCES public.tasks(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  voucher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL DEFAULT 'task-proofs'::text,
  object_path TEXT NOT NULL,
  media_kind TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INT NOT NULL,
  duration_ms INT,
  upload_state TEXT NOT NULL DEFAULT 'PENDING'::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  overlay_timestamp_text TEXT NOT NULL DEFAULT '??:?? ??/??/??'::text,

  CONSTRAINT task_completion_proofs_bucket_object_path_key
    UNIQUE (bucket, object_path),
  CONSTRAINT task_completion_proofs_bucket_fixed
    CHECK (bucket = 'task-proofs'::text),
  CONSTRAINT task_completion_proofs_media_kind_check
    CHECK (media_kind = ANY (ARRAY['image','video'])),
  CONSTRAINT task_completion_proofs_upload_state_check
    CHECK (upload_state = ANY (ARRAY['PENDING','UPLOADED','FAILED'])),
  CONSTRAINT task_completion_proofs_size_bytes_check
    CHECK (size_bytes > 0),
  CONSTRAINT task_completion_proofs_duration_ms_check
    CHECK (duration_ms IS NULL OR (duration_ms > 0 AND duration_ms <= 30000))
);

-- ============================================
-- POMO SESSIONS
-- ============================================
CREATE TABLE public.pomo_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  duration_minutes INT NOT NULL,
  elapsed_seconds INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE'::text,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paused_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_strict BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT pomo_sessions_status_check
    CHECK (status = ANY (ARRAY['ACTIVE','PAUSED','COMPLETED','DELETED']))
);

-- ============================================
-- AI VOUCHES
-- ============================================
CREATE TABLE public.ai_vouches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  attempt_number INT NOT NULL,
  reason TEXT NOT NULL,
  vouched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decision TEXT NOT NULL DEFAULT 'denied'::text,
  approved_at TIMESTAMPTZ,

  CONSTRAINT ai_vouches_decision_check
    CHECK (decision = ANY (ARRAY['approved','denied']))
);

-- ============================================
-- LEDGER ENTRIES
-- ============================================
CREATE TABLE public.ledger_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  amount_cents INT NOT NULL,
  entry_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ledger_entries_entry_type_check
    CHECK (entry_type = ANY (ARRAY['failure','rectified','override','voucher_timeout_penalty'])),
  CONSTRAINT ledger_entries_period_format
    CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

-- ============================================
-- OVERRIDES (formerly force_majeure)
-- ============================================
CREATE TABLE public.overrides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT overrides_user_period_unique UNIQUE (user_id, period),
  CONSTRAINT overrides_period_format
    CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

-- ============================================
-- RECTIFY PASSES
-- ============================================
CREATE TABLE public.rectify_passes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  authorized_by UUID NOT NULL REFERENCES public.profiles(id),
  period TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT rectify_passes_period_format
    CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

-- ============================================
-- GOOGLE CALENDAR CONNECTIONS
-- ============================================
CREATE TABLE public.google_calendar_connections (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  google_account_email TEXT,
  selected_calendar_id TEXT,
  selected_calendar_summary TEXT,
  encrypted_access_token TEXT,
  encrypted_refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  watch_channel_id TEXT,
  watch_resource_id TEXT,
  watch_expires_at TIMESTAMPTZ,
  sync_token TEXT,
  last_webhook_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  import_only_tagged_google_events BOOLEAN NOT NULL DEFAULT false,
  sync_app_to_google_enabled BOOLEAN NOT NULL DEFAULT false,
  sync_google_to_app_enabled BOOLEAN NOT NULL DEFAULT false
);

-- ============================================
-- GOOGLE CALENDAR SYNC OUTBOX
-- ============================================
CREATE TABLE public.google_calendar_sync_outbox (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  intent TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'::text,
  attempt_count INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT google_calendar_sync_outbox_intent_check
    CHECK (intent = ANY (ARRAY['UPSERT','DELETE'])),
  CONSTRAINT google_calendar_sync_outbox_status_check
    CHECK (status = ANY (ARRAY['PENDING','PROCESSING','DONE','FAILED'])),
  CONSTRAINT google_calendar_sync_outbox_attempt_count_check
    CHECK (attempt_count >= 0)
);

-- ============================================
-- GOOGLE CALENDAR TASK LINKS
-- ============================================
CREATE TABLE public.google_calendar_task_links (
  task_id UUID PRIMARY KEY REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL,
  google_event_id TEXT NOT NULL,
  last_google_etag TEXT,
  last_google_updated_at TIMESTAMPTZ,
  last_app_updated_at TIMESTAMPTZ,
  last_origin TEXT NOT NULL DEFAULT 'APP'::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT google_calendar_task_links_event_unique
    UNIQUE (user_id, calendar_id, google_event_id),
  CONSTRAINT google_calendar_task_links_last_origin_check
    CHECK (last_origin = ANY (ARRAY['APP','GOOGLE']))
);

-- ============================================
-- VOUCHER REMINDER LOGS
-- ============================================
CREATE TABLE public.voucher_reminder_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voucher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reminder_date DATE NOT NULL,
  pending_count INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT voucher_reminder_logs_voucher_id_reminder_date_key
    UNIQUE (voucher_id, reminder_date),
  CONSTRAINT voucher_reminder_logs_pending_count_check
    CHECK (pending_count >= 0)
);

-- ============================================
-- WEB PUSH SUBSCRIPTIONS
-- ============================================
CREATE TABLE public.web_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT web_push_subscriptions_user_id_subscription_key
    UNIQUE (user_id, subscription)
);
