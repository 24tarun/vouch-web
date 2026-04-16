--
-- 077: Core tables — profiles, friendships, recurrence_rules, tasks, commitments, commitment_task_links
--

-- ============================================
-- PROFILES
-- ============================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  default_pomo_duration_minutes INT NOT NULL DEFAULT 25,
  default_failure_cost_cents INT NOT NULL DEFAULT 100,
  default_voucher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  hide_tips BOOLEAN NOT NULL DEFAULT false,
  strict_pomo_enabled BOOLEAN NOT NULL DEFAULT false,
  deadline_final_warning_enabled BOOLEAN NOT NULL DEFAULT true,
  currency TEXT NOT NULL DEFAULT 'EUR'::text,
  deadline_one_hour_warning_enabled BOOLEAN NOT NULL DEFAULT true,
  voucher_can_view_active_tasks BOOLEAN NOT NULL DEFAULT true,
  default_event_duration_minutes INT NOT NULL DEFAULT 60,
  lifetime_xp INT NOT NULL DEFAULT 0,
  display_xp_bar_on_dashboard BOOLEAN NOT NULL DEFAULT false,
  display_rp_bar_on_dashboard BOOLEAN NOT NULL DEFAULT true,
  mobile_notifications_enabled BOOLEAN NOT NULL DEFAULT false,
  abandoned_commitments_count INT NOT NULL DEFAULT 0,
  ai_friend_opt_in BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT profiles_currency_check
    CHECK (currency = ANY (ARRAY['EUR'::text, 'USD'::text, 'INR'::text])),
  CONSTRAINT profiles_default_failure_cost_cents_check
    CHECK (default_failure_cost_cents >= 1 AND default_failure_cost_cents <= 100000),
  CONSTRAINT profiles_default_pomo_duration_minutes_check
    CHECK (default_pomo_duration_minutes >= 1 AND default_pomo_duration_minutes <= 720),
  CONSTRAINT profiles_default_event_duration_minutes_check
    CHECK (default_event_duration_minutes >= 1 AND default_event_duration_minutes <= 720),
  CONSTRAINT profiles_lifetime_xp_nonnegative_check
    CHECK (lifetime_xp >= 0),
  CONSTRAINT profiles_abandoned_commitments_count_non_negative
    CHECK (abandoned_commitments_count >= 0)
);

-- ============================================
-- FRIENDSHIPS
-- ============================================
CREATE TABLE public.friendships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT friendships_user_id_friend_id_key UNIQUE (user_id, friend_id),
  CONSTRAINT friendships_check CHECK (user_id <> friend_id)
);

-- ============================================
-- RECURRENCE RULES
-- ============================================
CREATE TABLE public.recurrence_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  voucher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  failure_cost_cents INT NOT NULL,
  rule_config JSONB NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC'::text,
  last_generated_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  required_pomo_minutes INT,
  manual_reminder_offsets_ms JSONB,
  google_event_duration_minutes INT,
  google_sync_for_rule BOOLEAN NOT NULL DEFAULT false,
  google_event_color_id TEXT,
  requires_proof BOOLEAN NOT NULL DEFAULT false,
  latest_iteration INT NOT NULL DEFAULT 0,

  CONSTRAINT recurrence_rules_required_pomo_minutes_check
    CHECK (required_pomo_minutes IS NULL OR (required_pomo_minutes >= 1 AND required_pomo_minutes <= 10000)),
  CONSTRAINT recurrence_rules_manual_reminder_offsets_ms_is_array
    CHECK (manual_reminder_offsets_ms IS NULL OR jsonb_typeof(manual_reminder_offsets_ms) = 'array'::text),
  CONSTRAINT recurrence_rules_google_event_duration_minutes_check
    CHECK (google_event_duration_minutes IS NULL OR google_event_duration_minutes > 0),
  CONSTRAINT recurrence_rules_google_event_color_id_check
    CHECK (google_event_color_id IS NULL OR google_event_color_id = ANY (ARRAY['1','2','3','4','5','6','7','8','9','10','11'])),
  CONSTRAINT recurrence_rules_latest_iteration_non_negative
    CHECK (latest_iteration >= 0)
);

-- ============================================
-- TASKS
-- ============================================
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  voucher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  failure_cost_cents INT NOT NULL,
  deadline TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'CREATED'::text,
  postponed_at TIMESTAMPTZ,
  marked_completed_at TIMESTAMPTZ,
  voucher_response_deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recurrence_rule_id UUID REFERENCES public.recurrence_rules(id) ON DELETE SET NULL,
  required_pomo_minutes INT,
  proof_request_open BOOLEAN NOT NULL DEFAULT false,
  proof_requested_at TIMESTAMPTZ,
  proof_requested_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  google_event_end_at TIMESTAMPTZ,
  google_sync_for_task BOOLEAN NOT NULL DEFAULT false,
  google_event_color_id TEXT,
  voucher_timeout_auto_accepted BOOLEAN NOT NULL DEFAULT false,
  requires_proof BOOLEAN NOT NULL DEFAULT false,
  google_event_start_at TIMESTAMPTZ,
  has_proof BOOLEAN NOT NULL DEFAULT false,
  iteration_number INT,
  ai_escalated_from BOOLEAN NOT NULL DEFAULT false,
  resubmit_count INT NOT NULL DEFAULT 0,
  ai_vouch_calls_count INT NOT NULL DEFAULT 0,

  CONSTRAINT tasks_failure_cost_cents_check
    CHECK (failure_cost_cents >= 1 AND failure_cost_cents <= 100000),
  CONSTRAINT tasks_status_check
    CHECK (status = ANY (ARRAY[
      'ACTIVE','POSTPONED','MARKED_COMPLETE','AWAITING_VOUCHER',
      'AWAITING_AI','AI_DENIED','AWAITING_USER','ESCALATED',
      'ACCEPTED','AUTO_ACCEPTED','AI_ACCEPTED',
      'DENIED','MISSED','RECTIFIED','SETTLED','DELETED'
    ])),
  CONSTRAINT tasks_required_pomo_minutes_check
    CHECK (required_pomo_minutes IS NULL OR (required_pomo_minutes >= 1 AND required_pomo_minutes <= 10000)),
  CONSTRAINT tasks_google_event_color_id_check
    CHECK (google_event_color_id IS NULL OR google_event_color_id = ANY (ARRAY['1','2','3','4','5','6','7','8','9','10','11'])),
  CONSTRAINT tasks_iteration_number_required_for_recurring
    CHECK (recurrence_rule_id IS NULL OR (iteration_number IS NOT NULL AND iteration_number > 0))
);

-- ============================================
-- COMMITMENTS
-- ============================================
CREATE TABLE public.commitments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT'::text,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  description TEXT NOT NULL,

  CONSTRAINT commitments_name_not_blank CHECK (char_length(btrim(name)) > 0),
  CONSTRAINT commitments_status_check
    CHECK (status = ANY (ARRAY['DRAFT','ACTIVE','COMPLETED','FAILED'])),
  CONSTRAINT commitments_min_duration_check CHECK ((end_date - start_date) >= 3),
  CONSTRAINT commitments_description_range_check
    CHECK (char_length(btrim(description)) >= 10 AND char_length(description) <= 500)
);

-- ============================================
-- COMMITMENT TASK LINKS
-- ============================================
CREATE TABLE public.commitment_task_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  commitment_id UUID NOT NULL REFERENCES public.commitments(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  recurrence_rule_id UUID REFERENCES public.recurrence_rules(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT commitment_task_links_exactly_one_target_check
    CHECK (
      (task_id IS NOT NULL AND recurrence_rule_id IS NULL)
      OR (task_id IS NULL AND recurrence_rule_id IS NOT NULL)
    )
);
