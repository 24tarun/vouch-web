-- ============================================================
-- VOUCH — Consolidated Schema Snapshot
-- Generated: 2026-04-19
-- This file is the authoritative source of truth for the DB schema.
-- ============================================================


-- ============================================================
-- EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_graphql";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "supabase_vault";


-- ============================================================
-- UTILITY FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_period()
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  RETURN TO_CHAR(NOW(), 'YYYY-MM');
END;
$$;

CREATE OR REPLACE FUNCTION public.override_available(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM overrides
    WHERE user_id = p_user_id AND period = current_period()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.are_users_blocked(p_user_a uuid, p_user_b uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_blocks ub
    WHERE (ub.blocker_id = p_user_a AND ub.blocked_id = p_user_b)
       OR (ub.blocker_id = p_user_b AND ub.blocked_id = p_user_a)
  );
$$;

CREATE OR REPLACE FUNCTION public.has_pending_voucher_conflict(p_user_a uuid, p_user_b uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.status = ANY (
      ARRAY[
        'ACTIVE',
        'POSTPONED',
        'MARKED_COMPLETE',
        'AWAITING_VOUCHER',
        'AWAITING_AI',
        'AWAITING_USER',
        'ESCALATED'
      ]::text[]
    )
      AND (
        (t.user_id = p_user_a AND t.voucher_id = p_user_b)
        OR
        (t.user_id = p_user_b AND t.voucher_id = p_user_a)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.increment_profile_lifetime_xp(p_user_id uuid, p_delta integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF p_user_id IS NULL OR p_delta IS NULL OR p_delta = 0 THEN
    RETURN;
  END IF;
  UPDATE public.profiles
  SET lifetime_xp = GREATEST(0, COALESCE(lifetime_xp, 0) + p_delta)
  WHERE id = p_user_id;
END;
$$;


-- ============================================================
-- TRIGGER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, username, default_voucher_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'username',
      SPLIT_PART(NEW.email, '@', 1) || '_' || SUBSTRING(NEW.id::TEXT, 1, 8)
    ),
    NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_recurrence_task_iteration_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.recurrence_rule_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE recurrence_rules
  SET
    latest_iteration = COALESCE(latest_iteration, 0) + 1,
    updated_at = NOW()
  WHERE id = NEW.recurrence_rule_id
  RETURNING latest_iteration INTO NEW.iteration_number;

  IF NEW.iteration_number IS NULL THEN
    RAISE EXCEPTION
      'Cannot assign iteration number: recurrence rule % not found',
      NEW.recurrence_rule_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_rectify_pass_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM rectify_passes
    WHERE user_id = NEW.user_id
      AND period = NEW.period
  ) >= 5 THEN
    RAISE EXCEPTION 'Rectify pass limit of 5 per month reached for user % in period %', NEW.user_id, NEW.period;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_subtasks_on_task_completion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN (
      'MARKED_COMPLETE',
      'AWAITING_VOUCHER',
      'AWAITING_AI',
      'ACCEPTED',
      'AUTO_ACCEPTED',
      'AI_ACCEPTED'
    )
    AND OLD.status IS DISTINCT FROM NEW.status THEN
    DELETE FROM public.task_subtasks
    WHERE parent_task_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_task_subtask_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_count INT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.parent_task_id = OLD.parent_task_id THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)
    INTO current_count
  FROM task_subtasks
  WHERE parent_task_id = NEW.parent_task_id;

  IF current_count >= 20 THEN
    RAISE EXCEPTION 'A task cannot have more than 20 subtasks.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_task_proof_location_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.bucket IS DISTINCT FROM OLD.bucket THEN
    RAISE EXCEPTION 'bucket is immutable';
  END IF;
  IF NEW.object_path IS DISTINCT FROM OLD.object_path THEN
    RAISE EXCEPTION 'object_path is immutable';
  END IF;
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'owner_id is immutable';
  END IF;
  IF NEW.voucher_id IS DISTINCT FROM OLD.voucher_id THEN
    RAISE EXCEPTION 'voucher_id is immutable';
  END IF;
  IF NEW.task_id IS DISTINCT FROM OLD.task_id THEN
    RAISE EXCEPTION 'task_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_task_user_id_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id <> OLD.user_id THEN
    RAISE EXCEPTION 'tasks.user_id is immutable and cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_abandoned_commitments_count()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only count deletions of ACTIVE commitments as abandonment
  IF OLD.status = 'ACTIVE' THEN
    UPDATE public.profiles
    SET abandoned_commitments_count = COALESCE(abandoned_commitments_count, 0) + 1
    WHERE id = OLD.user_id;
  END IF;
  RETURN OLD;
END;
$$;


-- ============================================================
-- SOCIAL / SECURITY DEFINER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.search_users_for_friendship(p_query text, p_limit integer DEFAULT 20)
RETURNS TABLE(
  id                        uuid,
  email                     text,
  username                  text,
  already_friends           boolean,
  incoming_request_pending  boolean,
  outgoing_request_pending  boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH me AS (
    SELECT auth.uid() AS user_id
  )
  SELECT
    p.id,
    p.email,
    p.username,
    EXISTS (
      SELECT 1 FROM public.friendships f, me
      WHERE f.user_id = me.user_id AND f.friend_id = p.id
    ) AS already_friends,
    EXISTS (
      SELECT 1 FROM public.friend_requests fr, me
      WHERE fr.sender_id = p.id
        AND fr.receiver_id = me.user_id
        AND fr.status = 'PENDING'
    ) AS incoming_request_pending,
    EXISTS (
      SELECT 1 FROM public.friend_requests fr, me
      WHERE fr.sender_id = me.user_id
        AND fr.receiver_id = p.id
        AND fr.status = 'PENDING'
    ) AS outgoing_request_pending
  FROM public.profiles p, me
  WHERE me.user_id IS NOT NULL
    AND p.id <> me.user_id
    AND (
      p.email    ILIKE '%' || trim(coalesce(p_query, '')) || '%'
      OR p.username ILIKE '%' || trim(coalesce(p_query, '')) || '%'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks ub
      WHERE (ub.blocker_id = me.user_id AND ub.blocked_id = p.id)
         OR (ub.blocker_id = p.id        AND ub.blocked_id = me.user_id)
    )
  ORDER BY p.username ASC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 20), 50));
$$;

CREATE OR REPLACE FUNCTION public.send_friend_request(p_target_user_id uuid)
RETURNS TABLE(request_id uuid, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_request_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user is required';
  END IF;
  IF p_target_user_id = v_user_id THEN
    RAISE EXCEPTION 'You cannot send a friend request to yourself';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_target_user_id) THEN
    RAISE EXCEPTION 'No user found for that target';
  END IF;
  IF public.are_users_blocked(v_user_id, p_target_user_id) THEN
    RAISE EXCEPTION 'You cannot send a friend request for this user';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.friendships f
    WHERE f.user_id = v_user_id AND f.friend_id = p_target_user_id
  ) THEN
    RAISE EXCEPTION 'Already friends with this user';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.friend_requests fr
    WHERE fr.status = 'PENDING'
      AND (
        (fr.sender_id = v_user_id AND fr.receiver_id = p_target_user_id)
        OR (fr.sender_id = p_target_user_id AND fr.receiver_id = v_user_id)
      )
  ) THEN
    RAISE EXCEPTION 'A friend request is already pending for this user';
  END IF;

  INSERT INTO public.friend_requests (sender_id, receiver_id, status)
  VALUES (v_user_id, p_target_user_id, 'PENDING')
  RETURNING id INTO v_request_id;

  RETURN QUERY SELECT v_request_id, 'PENDING'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_friend_request(p_request_id uuid)
RETURNS TABLE(request_id uuid, friend_user_id uuid, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_sender_id  UUID;
  v_receiver_id UUID;
  v_status     TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT fr.sender_id, fr.receiver_id, fr.status
  INTO v_sender_id, v_receiver_id, v_status
  FROM public.friend_requests fr WHERE fr.id = p_request_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Friend request not found'; END IF;
  IF v_receiver_id <> v_user_id THEN RAISE EXCEPTION 'You can only accept requests sent to you'; END IF;
  IF v_status <> 'PENDING' THEN RAISE EXCEPTION 'This friend request is no longer pending'; END IF;

  UPDATE public.friend_requests fr
  SET status = 'ACCEPTED', responded_at = now()
  WHERE fr.id = p_request_id AND fr.status = 'PENDING';

  INSERT INTO public.friendships (user_id, friend_id)
  VALUES (v_sender_id, v_receiver_id) ON CONFLICT (user_id, friend_id) DO NOTHING;

  INSERT INTO public.friendships (user_id, friend_id)
  VALUES (v_receiver_id, v_sender_id) ON CONFLICT (user_id, friend_id) DO NOTHING;

  RETURN QUERY SELECT p_request_id, v_sender_id, 'ACCEPTED'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_friend_request(p_request_id uuid)
RETURNS TABLE(request_id uuid, sender_user_id uuid, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_sender_id   UUID;
  v_receiver_id UUID;
  v_status      TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT fr.sender_id, fr.receiver_id, fr.status
  INTO v_sender_id, v_receiver_id, v_status
  FROM public.friend_requests fr WHERE fr.id = p_request_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Friend request not found'; END IF;
  IF v_receiver_id <> v_user_id THEN RAISE EXCEPTION 'You can only reject requests sent to you'; END IF;
  IF v_status <> 'PENDING' THEN RAISE EXCEPTION 'This friend request is no longer pending'; END IF;

  UPDATE public.friend_requests fr
  SET status = 'REJECTED', responded_at = now()
  WHERE fr.id = p_request_id AND fr.status = 'PENDING';

  RETURN QUERY SELECT p_request_id, v_sender_id, 'REJECTED'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.withdraw_friend_request(p_request_id uuid)
RETURNS TABLE(request_id uuid, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_user_id   UUID := auth.uid();
  v_sender_id UUID;
  v_status    TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT fr.sender_id, fr.status
  INTO v_sender_id, v_status
  FROM public.friend_requests fr WHERE fr.id = p_request_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Friend request not found'; END IF;
  IF v_sender_id <> v_user_id THEN RAISE EXCEPTION 'You can only withdraw requests you sent'; END IF;
  IF v_status <> 'PENDING' THEN RAISE EXCEPTION 'This friend request is no longer pending'; END IF;

  UPDATE public.friend_requests fr
  SET status = 'CANCELED', responded_at = now()
  WHERE fr.id = p_request_id AND fr.status = 'PENDING';

  RETURN QUERY SELECT p_request_id, 'CANCELED'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_friend(p_target_user_id uuid)
RETURNS TABLE(removed_user_id uuid, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_target_user_id IS NULL THEN RAISE EXCEPTION 'Target user is required'; END IF;
  IF public.has_pending_voucher_conflict(v_user_id, p_target_user_id) THEN
    RAISE EXCEPTION 'Cannot remove this friend because one of you is still the voucher for the other on pending tasks';
  END IF;

  DELETE FROM public.friendships
  WHERE (user_id = v_user_id AND friend_id = p_target_user_id)
     OR (user_id = p_target_user_id AND friend_id = v_user_id);

  UPDATE public.profiles SET default_voucher_id = v_user_id
  WHERE id = v_user_id AND default_voucher_id = p_target_user_id;

  UPDATE public.profiles SET default_voucher_id = p_target_user_id
  WHERE id = p_target_user_id AND default_voucher_id = v_user_id;

  RETURN QUERY SELECT p_target_user_id, 'REMOVED'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.block_user(p_target_user_id uuid)
RETURNS TABLE(blocked_user_id uuid, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_target_user_id IS NULL THEN RAISE EXCEPTION 'Target user is required'; END IF;
  IF p_target_user_id = v_user_id THEN RAISE EXCEPTION 'You cannot block yourself'; END IF;
  IF public.has_pending_voucher_conflict(v_user_id, p_target_user_id) THEN
    RAISE EXCEPTION 'Cannot block this user because one of you is still the voucher for the other on pending tasks';
  END IF;

  INSERT INTO public.user_blocks (blocker_id, blocked_id)
  VALUES (v_user_id, p_target_user_id)
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

  UPDATE public.friend_requests fr
  SET status = 'CANCELED', responded_at = now()
  WHERE fr.status = 'PENDING'
    AND (
      (fr.sender_id = v_user_id AND fr.receiver_id = p_target_user_id)
      OR (fr.sender_id = p_target_user_id AND fr.receiver_id = v_user_id)
    );

  UPDATE public.profiles SET default_voucher_id = v_user_id
  WHERE id = v_user_id AND default_voucher_id = p_target_user_id;

  UPDATE public.profiles SET default_voucher_id = p_target_user_id
  WHERE id = p_target_user_id AND default_voucher_id = v_user_id;

  RETURN QUERY SELECT p_target_user_id, 'BLOCKED'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.unblock_user(p_target_user_id uuid)
RETURNS TABLE(unblocked_user_id uuid, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  DELETE FROM public.user_blocks
  WHERE blocker_id = v_user_id AND blocked_id = p_target_user_id;

  RETURN QUERY SELECT p_target_user_id, 'UNBLOCKED'::text;
END;
$$;


-- ============================================================
-- TABLES (in dependency order)
-- ============================================================

CREATE TABLE public.profiles (
  id                                uuid        NOT NULL,
  email                             text        NOT NULL,
  username                          text        NOT NULL,
  created_at                        timestamptz NOT NULL DEFAULT now(),
  default_pomo_duration_minutes     integer     NOT NULL DEFAULT 25,
  default_failure_cost_cents        integer     NOT NULL DEFAULT 100,
  default_voucher_id                uuid,
  hide_tips                         boolean     NOT NULL DEFAULT false,
  strict_pomo_enabled               boolean     NOT NULL DEFAULT false,
  deadline_final_warning_enabled    boolean     NOT NULL DEFAULT true,
  currency                          text        NOT NULL DEFAULT 'EUR',
  deadline_one_hour_warning_enabled boolean     NOT NULL DEFAULT true,
  voucher_can_view_active_tasks     boolean     NOT NULL DEFAULT true,
  default_event_duration_minutes    integer     NOT NULL DEFAULT 60,
  lifetime_xp                       integer     NOT NULL DEFAULT 0,
  display_xp_bar_on_dashboard       boolean     NOT NULL DEFAULT false,
  display_rp_bar_on_dashboard       boolean     NOT NULL DEFAULT true,
  mobile_notifications_enabled      boolean     NOT NULL DEFAULT false,
  abandoned_commitments_count       integer     NOT NULL DEFAULT 0,
  ai_friend_opt_in                  boolean     NOT NULL DEFAULT false,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_username_key UNIQUE (username),
  CONSTRAINT profiles_currency_check
    CHECK (currency = ANY (ARRAY['EUR','USD','INR'])),
  CONSTRAINT profiles_default_event_duration_minutes_check
    CHECK (default_event_duration_minutes >= 1 AND default_event_duration_minutes <= 720),
  CONSTRAINT profiles_default_failure_cost_cents_check
    CHECK (default_failure_cost_cents >= 1 AND default_failure_cost_cents <= 100000),
  CONSTRAINT profiles_default_pomo_duration_minutes_check
    CHECK (default_pomo_duration_minutes >= 1 AND default_pomo_duration_minutes <= 720),
  CONSTRAINT profiles_lifetime_xp_nonnegative_check
    CHECK (lifetime_xp >= 0),
  CONSTRAINT profiles_abandoned_commitments_count_non_negative
    CHECK (abandoned_commitments_count >= 0)
);

-- Self-referencing FK added after table creation
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_default_voucher_id_fkey
    FOREIGN KEY (default_voucher_id) REFERENCES public.profiles (id) ON DELETE SET NULL;

CREATE TABLE public.user_client_instances (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL,
  platform     text        NOT NULL,
  client_name  text        NOT NULL,
  device_label text,
  app_version  text,
  metadata     jsonb       NOT NULL DEFAULT '{}',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_client_instances_pkey PRIMARY KEY (id),
  CONSTRAINT user_client_instances_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT user_client_instances_platform_check
    CHECK (platform = ANY (ARRAY['web','ios','android']))
);

CREATE TABLE public.recurrence_rules (
  id                            uuid        NOT NULL DEFAULT uuid_generate_v4(),
  user_id                       uuid        NOT NULL,
  voucher_id                    uuid,
  title                         text        NOT NULL,
  description                   text,
  failure_cost_cents            integer     NOT NULL,
  rule_config                   jsonb       NOT NULL,
  timezone                      text        NOT NULL DEFAULT 'UTC',
  last_generated_date           date,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  required_pomo_minutes         integer,
  manual_reminder_offsets_ms    jsonb,
  google_event_duration_minutes integer,
  google_sync_for_rule          boolean     NOT NULL DEFAULT false,
  google_event_color_id         text,
  requires_proof                boolean     NOT NULL DEFAULT false,
  latest_iteration              integer     NOT NULL DEFAULT 0,
  CONSTRAINT recurrence_rules_pkey PRIMARY KEY (id),
  CONSTRAINT recurrence_rules_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT recurrence_rules_voucher_id_fkey
    FOREIGN KEY (voucher_id) REFERENCES public.profiles (id) ON DELETE SET NULL,
  CONSTRAINT recurrence_rules_google_event_color_id_check
    CHECK (google_event_color_id IS NULL OR google_event_color_id = ANY (ARRAY['1','2','3','4','5','6','7','8','9','10','11'])),
  CONSTRAINT recurrence_rules_google_event_duration_minutes_check
    CHECK (google_event_duration_minutes IS NULL OR google_event_duration_minutes > 0),
  CONSTRAINT recurrence_rules_latest_iteration_non_negative
    CHECK (latest_iteration >= 0),
  CONSTRAINT recurrence_rules_manual_reminder_offsets_ms_is_array
    CHECK (manual_reminder_offsets_ms IS NULL OR jsonb_typeof(manual_reminder_offsets_ms) = 'array'),
  CONSTRAINT recurrence_rules_required_pomo_minutes_check
    CHECK (required_pomo_minutes IS NULL OR (required_pomo_minutes >= 1 AND required_pomo_minutes <= 10000))
);

CREATE TABLE public.tasks (
  id                                uuid        NOT NULL DEFAULT uuid_generate_v4(),
  user_id                           uuid        NOT NULL,
  voucher_id                        uuid        NOT NULL,
  title                             text        NOT NULL,
  description                       text,
  failure_cost_cents                integer     NOT NULL,
  deadline                          timestamptz NOT NULL,
  -- Default 'CREATED' is the initial value; the status check constraint enforces valid transitions
  status                            text        NOT NULL DEFAULT 'CREATED',
  postponed_at                      timestamptz,
  marked_completed_at               timestamptz,
  voucher_response_deadline         timestamptz,
  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now(),
  recurrence_rule_id                uuid,
  required_pomo_minutes             integer,
  proof_request_open                boolean     NOT NULL DEFAULT false,
  proof_requested_at                timestamptz,
  proof_requested_by                uuid,
  google_event_end_at               timestamptz,
  google_sync_for_task              boolean     NOT NULL DEFAULT false,
  google_event_color_id             text,
  voucher_timeout_auto_accepted     boolean     NOT NULL DEFAULT false,
  requires_proof                    boolean     NOT NULL DEFAULT false,
  google_event_start_at             timestamptz,
  has_proof                         boolean     NOT NULL DEFAULT false,
  iteration_number                  integer,
  ai_escalated_from                 boolean     NOT NULL DEFAULT false,
  resubmit_count                    integer     NOT NULL DEFAULT 0,
  ai_vouch_calls_count              integer     NOT NULL DEFAULT 0,
  start_at                          timestamptz,
  is_strict                         boolean     NOT NULL DEFAULT false,
  created_by_user_client_instance_id uuid,
  CONSTRAINT tasks_pkey PRIMARY KEY (id),
  CONSTRAINT tasks_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT tasks_voucher_id_fkey
    FOREIGN KEY (voucher_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT tasks_recurrence_rule_id_fkey
    FOREIGN KEY (recurrence_rule_id) REFERENCES public.recurrence_rules (id) ON DELETE SET NULL,
  CONSTRAINT tasks_proof_requested_by_fkey
    FOREIGN KEY (proof_requested_by) REFERENCES public.profiles (id) ON DELETE SET NULL,
  CONSTRAINT tasks_created_by_user_client_instance_id_fkey
    FOREIGN KEY (created_by_user_client_instance_id) REFERENCES public.user_client_instances (id) ON DELETE SET NULL,
  CONSTRAINT tasks_failure_cost_cents_check
    CHECK (failure_cost_cents >= 1 AND failure_cost_cents <= 100000),
  CONSTRAINT tasks_google_event_color_id_check
    CHECK (google_event_color_id IS NULL OR google_event_color_id = ANY (ARRAY['1','2','3','4','5','6','7','8','9','10','11'])),
  CONSTRAINT tasks_required_pomo_minutes_check
    CHECK (required_pomo_minutes IS NULL OR (required_pomo_minutes >= 1 AND required_pomo_minutes <= 10000)),
  CONSTRAINT tasks_status_check
    CHECK (status = ANY (ARRAY[
      'ACTIVE','POSTPONED','MARKED_COMPLETE','AWAITING_VOUCHER','AWAITING_AI',
      'AI_DENIED','AWAITING_USER','ESCALATED','ACCEPTED','AUTO_ACCEPTED',
      'AI_ACCEPTED','DENIED','MISSED','RECTIFIED','SETTLED','DELETED'
    ]))
);

CREATE TABLE public.task_events (
  id                            uuid        NOT NULL DEFAULT uuid_generate_v4(),
  task_id                       uuid        NOT NULL,
  event_type                    text        NOT NULL,
  actor_id                      uuid,
  from_status                   text        NOT NULL,
  to_status                     text        NOT NULL,
  metadata                      jsonb,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  actor_user_client_instance_id uuid,
  CONSTRAINT task_events_pkey PRIMARY KEY (id),
  CONSTRAINT task_events_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES public.tasks (id) ON DELETE CASCADE,
  CONSTRAINT task_events_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES public.profiles (id) ON DELETE SET NULL,
  CONSTRAINT task_events_actor_user_client_instance_id_fkey
    FOREIGN KEY (actor_user_client_instance_id) REFERENCES public.user_client_instances (id) ON DELETE SET NULL,
  CONSTRAINT task_events_event_type_check
    CHECK (event_type = ANY (ARRAY[
      'ACTIVE','MARK_COMPLETE','UNDO_COMPLETE','PROOF_UPLOADED','PROOF_UPLOAD_FAILED_REVERT',
      'PROOF_REMOVED','PROOF_REQUESTED','VOUCHER_ACCEPT','VOUCHER_DENY','VOUCHER_DELETE',
      'RECTIFY','OVERRIDE','DEADLINE_MISSED','VOUCHER_TIMEOUT','POMO_COMPLETED',
      'DEADLINE_WARNING_1H','DEADLINE_WARNING_10M','GOOGLE_EVENT_CANCELLED','POSTPONE',
      'REPETITION_STOPPED','AI_APPROVE','AI_DENY','AI_DENIED_AUTO_HOP','ESCALATE',
      'AI_ESCALATE_TO_HUMAN','ACCEPT_DENIAL'
    ])),
  CONSTRAINT task_events_from_status_check
    CHECK (from_status = ANY (ARRAY[
      'ACTIVE','POSTPONED','MARKED_COMPLETE','AWAITING_VOUCHER','AWAITING_AI',
      'AI_DENIED','AWAITING_USER','ESCALATED','ACCEPTED','AUTO_ACCEPTED',
      'AI_ACCEPTED','DENIED','MISSED','RECTIFIED','SETTLED','DELETED'
    ])),
  CONSTRAINT task_events_to_status_check
    CHECK (to_status = ANY (ARRAY[
      'ACTIVE','POSTPONED','MARKED_COMPLETE','AWAITING_VOUCHER','AWAITING_AI',
      'AI_DENIED','AWAITING_USER','ESCALATED','ACCEPTED','AUTO_ACCEPTED',
      'AI_ACCEPTED','DENIED','MISSED','RECTIFIED','SETTLED','DELETED'
    ]))
);

CREATE TABLE public.task_completion_proofs (
  id                   uuid        NOT NULL DEFAULT uuid_generate_v4(),
  task_id              uuid        NOT NULL,
  owner_id             uuid        NOT NULL,
  voucher_id           uuid        NOT NULL,
  bucket               text        NOT NULL DEFAULT 'task-proofs',
  object_path          text        NOT NULL,
  media_kind           text        NOT NULL,
  mime_type            text        NOT NULL,
  size_bytes           integer     NOT NULL,
  duration_ms          integer,
  upload_state         text        NOT NULL DEFAULT 'PENDING',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  overlay_timestamp_text text      NOT NULL DEFAULT '??:?? ??/??/??',
  CONSTRAINT task_completion_proofs_pkey PRIMARY KEY (id),
  CONSTRAINT task_completion_proofs_task_id_key UNIQUE (task_id),
  CONSTRAINT task_completion_proofs_bucket_object_path_key UNIQUE (bucket, object_path),
  CONSTRAINT task_completion_proofs_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES public.tasks (id) ON DELETE CASCADE,
  CONSTRAINT task_completion_proofs_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT task_completion_proofs_voucher_id_fkey
    FOREIGN KEY (voucher_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT task_completion_proofs_bucket_fixed
    CHECK (bucket = 'task-proofs'),
  CONSTRAINT task_completion_proofs_duration_ms_check
    CHECK (duration_ms IS NULL OR (duration_ms > 0 AND duration_ms <= 30000)),
  CONSTRAINT task_completion_proofs_media_kind_check
    CHECK (media_kind = ANY (ARRAY['image','video'])),
  CONSTRAINT task_completion_proofs_size_bytes_check
    CHECK (size_bytes > 0),
  CONSTRAINT task_completion_proofs_upload_state_check
    CHECK (upload_state = ANY (ARRAY['PENDING','UPLOADED','FAILED']))
);

CREATE TABLE public.task_subtasks (
  id             uuid        NOT NULL DEFAULT uuid_generate_v4(),
  parent_task_id uuid        NOT NULL,
  user_id        uuid        NOT NULL,
  title          text        NOT NULL,
  is_completed   boolean     NOT NULL DEFAULT false,
  completed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_subtasks_pkey PRIMARY KEY (id),
  CONSTRAINT task_subtasks_parent_task_id_fkey
    FOREIGN KEY (parent_task_id) REFERENCES public.tasks (id) ON DELETE CASCADE,
  CONSTRAINT task_subtasks_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT task_subtasks_title_not_blank
    CHECK (char_length(btrim(title)) > 0)
);

CREATE TABLE public.task_reminders (
  id             uuid        NOT NULL DEFAULT uuid_generate_v4(),
  parent_task_id uuid        NOT NULL,
  user_id        uuid        NOT NULL,
  reminder_at    timestamptz NOT NULL,
  notified_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  source         text        NOT NULL DEFAULT 'MANUAL',
  CONSTRAINT task_reminders_pkey PRIMARY KEY (id),
  CONSTRAINT task_reminders_parent_task_id_reminder_at_key UNIQUE (parent_task_id, reminder_at),
  CONSTRAINT task_reminders_parent_task_id_fkey
    FOREIGN KEY (parent_task_id) REFERENCES public.tasks (id) ON DELETE CASCADE,
  CONSTRAINT task_reminders_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT task_reminders_source_check
    CHECK (source = ANY (ARRAY['MANUAL','DEFAULT_DEADLINE_1H','DEFAULT_DEADLINE_10M']))
);

CREATE TABLE public.ledger_entries (
  id           uuid        NOT NULL DEFAULT uuid_generate_v4(),
  user_id      uuid        NOT NULL,
  task_id      uuid        NOT NULL,
  period       text        NOT NULL,
  amount_cents integer     NOT NULL,
  entry_type   text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entries_pkey PRIMARY KEY (id),
  CONSTRAINT ledger_entries_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT ledger_entries_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES public.tasks (id) ON DELETE CASCADE,
  CONSTRAINT ledger_entries_entry_type_check
    CHECK (entry_type = ANY (ARRAY['failure','rectified','override','voucher_timeout_penalty'])),
  CONSTRAINT ledger_entries_period_format
    CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

CREATE TABLE public.overrides (
  id         uuid        NOT NULL DEFAULT uuid_generate_v4(),
  user_id    uuid        NOT NULL,
  task_id    uuid        NOT NULL,
  period     text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT overrides_pkey PRIMARY KEY (id),
  CONSTRAINT overrides_user_period_unique UNIQUE (user_id, period),
  CONSTRAINT overrides_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT overrides_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES public.tasks (id) ON DELETE CASCADE,
  CONSTRAINT overrides_period_format
    CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

CREATE TABLE public.rectify_passes (
  id            uuid        NOT NULL DEFAULT uuid_generate_v4(),
  user_id       uuid        NOT NULL,
  task_id       uuid        NOT NULL,
  authorized_by uuid,
  period        text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rectify_passes_pkey PRIMARY KEY (id),
  CONSTRAINT rectify_passes_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT rectify_passes_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES public.tasks (id) ON DELETE CASCADE,
  CONSTRAINT rectify_passes_authorized_by_fkey
    FOREIGN KEY (authorized_by) REFERENCES public.profiles (id) ON DELETE NO ACTION,
  CONSTRAINT rectify_passes_period_format
    CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

CREATE TABLE public.pomo_sessions (
  id               uuid        NOT NULL DEFAULT uuid_generate_v4(),
  user_id          uuid        NOT NULL,
  task_id          uuid        NOT NULL,
  duration_minutes integer     NOT NULL,
  elapsed_seconds  integer     NOT NULL DEFAULT 0,
  status           text        NOT NULL DEFAULT 'ACTIVE',
  started_at       timestamptz NOT NULL DEFAULT now(),
  paused_at        timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  is_strict        boolean     NOT NULL DEFAULT false,
  CONSTRAINT pomo_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT pomo_sessions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT pomo_sessions_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES public.tasks (id) ON DELETE CASCADE,
  CONSTRAINT pomo_sessions_status_check
    CHECK (status = ANY (ARRAY['ACTIVE','PAUSED','COMPLETED','DELETED']))
);

CREATE TABLE public.ai_vouches (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  task_id        uuid        NOT NULL,
  attempt_number integer     NOT NULL,
  reason         text        NOT NULL,
  vouched_at     timestamptz NOT NULL DEFAULT now(),
  decision       text        NOT NULL DEFAULT 'denied',
  approved_at    timestamptz,
  CONSTRAINT ai_vouch_denials_pkey PRIMARY KEY (id),
  CONSTRAINT ai_vouch_denials_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES public.tasks (id) ON DELETE CASCADE,
  CONSTRAINT ai_vouches_decision_check
    CHECK (decision = ANY (ARRAY['approved','denied']))
);

CREATE TABLE public.commitments (
  id          uuid        NOT NULL DEFAULT uuid_generate_v4(),
  user_id     uuid        NOT NULL,
  name        text        NOT NULL,
  status      text        NOT NULL DEFAULT 'DRAFT',
  start_date  date        NOT NULL,
  end_date    date        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  description text        NOT NULL,
  CONSTRAINT commitments_pkey PRIMARY KEY (id),
  CONSTRAINT commitments_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT commitments_description_range_check
    CHECK (char_length(btrim(description)) >= 10 AND char_length(description) <= 500),
  CONSTRAINT commitments_min_duration_check
    CHECK ((end_date - start_date) >= 2),
  CONSTRAINT commitments_name_not_blank
    CHECK (char_length(btrim(name)) > 0),
  CONSTRAINT commitments_status_check
    CHECK (status = ANY (ARRAY['DRAFT','ACTIVE','COMPLETED','FAILED']))
);

CREATE TABLE public.commitment_task_links (
  id                 uuid        NOT NULL DEFAULT uuid_generate_v4(),
  commitment_id      uuid        NOT NULL,
  task_id            uuid,
  recurrence_rule_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commitment_task_links_pkey PRIMARY KEY (id),
  CONSTRAINT commitment_task_links_commitment_id_fkey
    FOREIGN KEY (commitment_id) REFERENCES public.commitments (id) ON DELETE CASCADE,
  CONSTRAINT commitment_task_links_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES public.tasks (id) ON DELETE SET NULL,
  CONSTRAINT commitment_task_links_recurrence_rule_id_fkey
    FOREIGN KEY (recurrence_rule_id) REFERENCES public.recurrence_rules (id) ON DELETE SET NULL
);

CREATE TABLE public.friend_requests (
  id           uuid        NOT NULL DEFAULT uuid_generate_v4(),
  sender_id    uuid        NOT NULL,
  receiver_id  uuid        NOT NULL,
  status       text        NOT NULL DEFAULT 'PENDING',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CONSTRAINT friend_requests_pkey PRIMARY KEY (id),
  CONSTRAINT friend_requests_sender_id_fkey
    FOREIGN KEY (sender_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT friend_requests_receiver_id_fkey
    FOREIGN KEY (receiver_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT friend_requests_check_distinct_users
    CHECK (sender_id <> receiver_id),
  CONSTRAINT friend_requests_status_check
    CHECK (status = ANY (ARRAY['PENDING','ACCEPTED','REJECTED','CANCELED']))
);

CREATE TABLE public.friendships (
  id         uuid        NOT NULL DEFAULT uuid_generate_v4(),
  user_id    uuid        NOT NULL,
  friend_id  uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friendships_pkey PRIMARY KEY (id),
  CONSTRAINT friendships_user_id_friend_id_key UNIQUE (user_id, friend_id),
  CONSTRAINT friendships_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT friendships_friend_id_fkey
    FOREIGN KEY (friend_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT friendships_check
    CHECK (user_id <> friend_id)
);

CREATE TABLE public.user_blocks (
  id         uuid        NOT NULL DEFAULT uuid_generate_v4(),
  blocker_id uuid        NOT NULL,
  blocked_id uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_blocks_pkey PRIMARY KEY (id),
  CONSTRAINT user_blocks_blocker_blocked_key UNIQUE (blocker_id, blocked_id),
  CONSTRAINT user_blocks_blocker_id_fkey
    FOREIGN KEY (blocker_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT user_blocks_blocked_id_fkey
    FOREIGN KEY (blocked_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT user_blocks_check_distinct_users
    CHECK (blocker_id <> blocked_id)
);

CREATE TABLE public.expo_push_tokens (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL,
  token       text        NOT NULL,
  device_name text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expo_push_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT expo_push_tokens_token_unique UNIQUE (token),
  CONSTRAINT expo_push_tokens_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE
);

CREATE TABLE public.web_push_subscriptions (
  id           uuid        NOT NULL DEFAULT uuid_generate_v4(),
  user_id      uuid        NOT NULL,
  subscription jsonb       NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at   timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT web_push_subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT web_push_subscriptions_user_id_subscription_key UNIQUE (user_id, subscription)
);

CREATE TABLE public.voucher_reminder_logs (
  id            uuid        NOT NULL DEFAULT uuid_generate_v4(),
  voucher_id    uuid        NOT NULL,
  reminder_date date        NOT NULL,
  pending_count integer     NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voucher_reminder_logs_pkey PRIMARY KEY (id),
  CONSTRAINT voucher_reminder_logs_voucher_id_reminder_date_key UNIQUE (voucher_id, reminder_date),
  CONSTRAINT voucher_reminder_logs_voucher_id_fkey
    FOREIGN KEY (voucher_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT voucher_reminder_logs_pending_count_check
    CHECK (pending_count >= 0)
);

CREATE TABLE public.google_calendar_connections (
  user_id                         uuid        NOT NULL,
  google_account_email            text,
  selected_calendar_id            text,
  selected_calendar_summary       text,
  encrypted_access_token          text,
  encrypted_refresh_token         text,
  token_expires_at                timestamptz,
  watch_channel_id                text,
  watch_resource_id               text,
  watch_expires_at                timestamptz,
  sync_token                      text,
  last_webhook_at                 timestamptz,
  last_sync_at                    timestamptz,
  last_error                      text,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  import_only_tagged_google_events boolean    NOT NULL DEFAULT false,
  sync_app_to_google_enabled      boolean     NOT NULL DEFAULT false,
  sync_google_to_app_enabled      boolean     NOT NULL DEFAULT false,
  CONSTRAINT google_calendar_connections_pkey PRIMARY KEY (user_id),
  CONSTRAINT google_calendar_connections_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE
);

CREATE TABLE public.google_calendar_task_links (
  task_id               uuid        NOT NULL,
  user_id               uuid        NOT NULL,
  calendar_id           text        NOT NULL,
  google_event_id       text        NOT NULL,
  last_google_etag      text,
  last_google_updated_at timestamptz,
  last_app_updated_at   timestamptz,
  last_origin           text        NOT NULL DEFAULT 'APP',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_calendar_task_links_pkey PRIMARY KEY (task_id),
  CONSTRAINT google_calendar_task_links_event_unique UNIQUE (user_id, calendar_id, google_event_id),
  CONSTRAINT google_calendar_task_links_unique_event UNIQUE (task_id, google_event_id),
  CONSTRAINT google_calendar_task_links_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES public.tasks (id) ON DELETE CASCADE,
  CONSTRAINT google_calendar_task_links_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT google_calendar_task_links_last_origin_check
    CHECK (last_origin = ANY (ARRAY['APP','GOOGLE']))
);

CREATE TABLE public.google_calendar_sync_outbox (
  id              bigint      NOT NULL GENERATED ALWAYS AS IDENTITY,
  user_id         uuid        NOT NULL,
  task_id         uuid,
  intent          text        NOT NULL,
  status          text        NOT NULL DEFAULT 'PENDING',
  attempt_count   integer     NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_calendar_sync_outbox_pkey PRIMARY KEY (id),
  CONSTRAINT google_calendar_sync_outbox_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT google_calendar_sync_outbox_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES public.tasks (id) ON DELETE SET NULL,
  CONSTRAINT google_calendar_sync_outbox_attempt_count_check
    CHECK (attempt_count >= 0),
  CONSTRAINT google_calendar_sync_outbox_intent_check
    CHECK (intent = ANY (ARRAY['UPSERT','DELETE'])),
  CONSTRAINT google_calendar_sync_outbox_status_check
    CHECK (status = ANY (ARRAY['PENDING','PROCESSING','DONE','FAILED']))
);


-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX ai_vouches_task_id_idx
  ON public.ai_vouches USING btree (task_id);

CREATE INDEX commitment_task_links_recurrence_rule_id_idx
  ON public.commitment_task_links USING btree (recurrence_rule_id);
CREATE INDEX commitment_task_links_task_id_idx
  ON public.commitment_task_links USING btree (task_id);
CREATE UNIQUE INDEX idx_commitment_task_links_unique_rule
  ON public.commitment_task_links USING btree (commitment_id, recurrence_rule_id)
  WHERE recurrence_rule_id IS NOT NULL;
CREATE UNIQUE INDEX idx_commitment_task_links_unique_task
  ON public.commitment_task_links USING btree (commitment_id, task_id)
  WHERE task_id IS NOT NULL;

CREATE INDEX idx_commitments_user_id
  ON public.commitments USING btree (user_id);

CREATE INDEX expo_push_tokens_user_id_idx
  ON public.expo_push_tokens USING btree (user_id);

CREATE INDEX idx_friend_requests_pair_status
  ON public.friend_requests USING btree (sender_id, receiver_id, status);
CREATE INDEX idx_friend_requests_receiver_id
  ON public.friend_requests USING btree (receiver_id);
CREATE INDEX idx_friend_requests_sender_id
  ON public.friend_requests USING btree (sender_id);
CREATE UNIQUE INDEX idx_friend_requests_single_pending_pair
  ON public.friend_requests USING btree (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id))
  WHERE status = 'PENDING';
CREATE INDEX idx_friend_requests_status
  ON public.friend_requests USING btree (status);

CREATE INDEX idx_friendships_friend_id
  ON public.friendships USING btree (friend_id);
CREATE INDEX idx_friendships_user_id
  ON public.friendships USING btree (user_id);

CREATE INDEX google_calendar_sync_outbox_task_id_idx
  ON public.google_calendar_sync_outbox USING btree (task_id);
CREATE INDEX idx_google_calendar_outbox_pending
  ON public.google_calendar_sync_outbox USING btree (status, next_attempt_at)
  WHERE status = ANY (ARRAY['PENDING','FAILED']);
CREATE INDEX idx_google_calendar_outbox_user
  ON public.google_calendar_sync_outbox USING btree (user_id);

CREATE INDEX google_calendar_task_links_calendar_id_idx
  ON public.google_calendar_task_links USING btree (calendar_id);
CREATE INDEX idx_google_calendar_task_links_event
  ON public.google_calendar_task_links USING btree (user_id, calendar_id, google_event_id);
CREATE INDEX idx_google_calendar_task_links_user_id
  ON public.google_calendar_task_links USING btree (user_id);

CREATE INDEX idx_ledger_entries_task_id
  ON public.ledger_entries USING btree (task_id);
CREATE INDEX idx_ledger_user_period
  ON public.ledger_entries USING btree (user_id, period);

CREATE INDEX idx_force_majeure_user_period
  ON public.overrides USING btree (user_id, period);

CREATE INDEX idx_pomo_sessions_active_by_task
  ON public.pomo_sessions USING btree (task_id, elapsed_seconds)
  WHERE status <> 'DELETED';
CREATE INDEX idx_pomo_sessions_task_id
  ON public.pomo_sessions USING btree (task_id);
CREATE UNIQUE INDEX idx_single_active_or_paused_pomo
  ON public.pomo_sessions USING btree (user_id)
  WHERE status = ANY (ARRAY['ACTIVE','PAUSED']);

CREATE INDEX idx_rectify_passes_user_period
  ON public.rectify_passes USING btree (user_id, period);

CREATE INDEX idx_task_completion_proofs_state
  ON public.task_completion_proofs USING btree (upload_state, created_at);
CREATE INDEX idx_task_completion_proofs_task
  ON public.task_completion_proofs USING btree (task_id);
CREATE INDEX idx_task_completion_proofs_voucher
  ON public.task_completion_proofs USING btree (voucher_id);

CREATE INDEX idx_task_events_task_event_type
  ON public.task_events USING btree (task_id, event_type);
CREATE INDEX idx_task_events_task_id
  ON public.task_events USING btree (task_id);
CREATE INDEX task_events_actor_user_client_instance_id_idx
  ON public.task_events USING btree (actor_user_client_instance_id);

CREATE INDEX idx_task_reminders_due
  ON public.task_reminders USING btree (reminder_at)
  WHERE notified_at IS NULL;

CREATE INDEX idx_task_subtasks_parent_created_at
  ON public.task_subtasks USING btree (parent_task_id, created_at);
CREATE INDEX idx_task_subtasks_parent_task_id
  ON public.task_subtasks USING btree (parent_task_id);

CREATE INDEX idx_tasks_active_deadline
  ON public.tasks USING btree (deadline)
  WHERE status = ANY (ARRAY['ACTIVE','POSTPONED']);
CREATE INDEX idx_tasks_awaiting_voucher_deadline
  ON public.tasks USING btree (voucher_response_deadline)
  WHERE status = 'AWAITING_VOUCHER';
CREATE INDEX idx_tasks_deadline
  ON public.tasks USING btree (deadline);
CREATE INDEX idx_tasks_owner_open_proof_requests
  ON public.tasks USING btree (user_id)
  WHERE proof_request_open = true
    AND status = ANY (ARRAY['AWAITING_VOUCHER','AWAITING_AI','MARKED_COMPLETE']);
CREATE INDEX idx_tasks_recurrence_rule_id
  ON public.tasks USING btree (recurrence_rule_id);
CREATE UNIQUE INDEX idx_tasks_recurrence_rule_iteration
  ON public.tasks USING btree (recurrence_rule_id, iteration_number)
  WHERE recurrence_rule_id IS NOT NULL AND iteration_number IS NOT NULL;
CREATE INDEX idx_tasks_user_id
  ON public.tasks USING btree (user_id);
CREATE INDEX idx_tasks_voucher_id
  ON public.tasks USING btree (voucher_id);
CREATE INDEX idx_tasks_voucher_status
  ON public.tasks USING btree (voucher_id, status);
CREATE INDEX tasks_created_by_user_client_instance_id_idx
  ON public.tasks USING btree (created_by_user_client_instance_id);

CREATE INDEX idx_user_blocks_blocked_id
  ON public.user_blocks USING btree (blocked_id);
CREATE INDEX idx_user_blocks_blocker_id
  ON public.user_blocks USING btree (blocker_id);

CREATE INDEX user_client_instances_last_seen_at_idx
  ON public.user_client_instances USING btree (last_seen_at DESC);
CREATE INDEX user_client_instances_user_id_idx
  ON public.user_client_instances USING btree (user_id);

CREATE INDEX idx_voucher_reminder_logs_voucher_date
  ON public.voucher_reminder_logs USING btree (voucher_id, reminder_date);


-- ============================================================
-- TRIGGERS
-- ============================================================

CREATE TRIGGER commitments_increment_abandoned_count
  AFTER DELETE ON public.commitments
  FOR EACH ROW EXECUTE FUNCTION public.increment_abandoned_commitments_count();

CREATE TRIGGER commitments_updated_at
  BEFORE UPDATE ON public.commitments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER expo_push_tokens_updated_at
  BEFORE UPDATE ON public.expo_push_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER friend_requests_updated_at
  BEFORE UPDATE ON public.friend_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER google_calendar_connections_updated_at
  BEFORE UPDATE ON public.google_calendar_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER google_calendar_sync_outbox_updated_at
  BEFORE UPDATE ON public.google_calendar_sync_outbox
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER google_calendar_task_links_updated_at
  BEFORE UPDATE ON public.google_calendar_task_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER pomo_sessions_updated_at
  BEFORE UPDATE ON public.pomo_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER enforce_rectify_pass_limit
  BEFORE INSERT ON public.rectify_passes
  FOR EACH ROW EXECUTE FUNCTION public.check_rectify_pass_limit();

CREATE TRIGGER task_completion_proofs_prevent_location_mutation
  BEFORE UPDATE ON public.task_completion_proofs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_task_proof_location_mutation();

CREATE TRIGGER task_completion_proofs_updated_at
  BEFORE UPDATE ON public.task_completion_proofs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER task_reminders_updated_at
  BEFORE UPDATE ON public.task_reminders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER task_subtasks_limit
  BEFORE INSERT OR UPDATE ON public.task_subtasks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_task_subtask_limit();

CREATE TRIGGER task_subtasks_updated_at
  BEFORE UPDATE ON public.task_subtasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER enforce_task_user_id_immutable
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.prevent_task_user_id_change();

CREATE TRIGGER tasks_delete_subtasks_on_completion
  AFTER UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.delete_subtasks_on_task_completion();

CREATE TRIGGER trg_assign_recurrence_task_iteration_number
  BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.assign_recurrence_task_iteration_number();

CREATE TRIGGER user_client_instances_updated_at
  BEFORE UPDATE ON public.user_client_instances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Trigger on auth.users to auto-create profile on signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.ai_vouches              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commitment_task_links   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commitments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expo_push_tokens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_requests         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_calendar_sync_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_calendar_task_links  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overrides               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pomo_sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rectify_passes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurrence_rules        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_completion_proofs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_reminders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_subtasks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_client_instances   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_reminder_logs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_push_subscriptions  ENABLE ROW LEVEL SECURITY;

-- ai_vouches
CREATE POLICY "Owner can read own ai_vouches"
  ON public.ai_vouches FOR SELECT
  USING (task_id IN (SELECT id FROM tasks WHERE user_id = auth.uid()));

-- commitment_task_links
CREATE POLICY "Users can view own commitment links"
  ON public.commitment_task_links FOR SELECT
  USING (EXISTS (SELECT 1 FROM commitments WHERE id = commitment_id AND user_id = auth.uid()));
CREATE POLICY "Users can insert own commitment links"
  ON public.commitment_task_links FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM commitments WHERE id = commitment_id AND user_id = auth.uid()));
CREATE POLICY "Users can update own commitment links"
  ON public.commitment_task_links FOR UPDATE
  USING (EXISTS (SELECT 1 FROM commitments WHERE id = commitment_id AND user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM commitments WHERE id = commitment_id AND user_id = auth.uid()));
CREATE POLICY "Users can delete own commitment links"
  ON public.commitment_task_links FOR DELETE
  USING (EXISTS (SELECT 1 FROM commitments WHERE id = commitment_id AND user_id = auth.uid()));

-- commitments
CREATE POLICY "Users can view own commitments"
  ON public.commitments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own commitments"
  ON public.commitments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own commitments"
  ON public.commitments FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own commitments"
  ON public.commitments FOR DELETE USING (auth.uid() = user_id);

-- expo_push_tokens
CREATE POLICY "Users can manage their own push tokens"
  ON public.expo_push_tokens FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- friend_requests
CREATE POLICY "Users can view own friend requests"
  ON public.friend_requests FOR SELECT
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- friendships
CREATE POLICY "Users can view own friendships"
  ON public.friendships FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create friendships"
  ON public.friendships FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own friendships"
  ON public.friendships FOR DELETE USING (auth.uid() = user_id);

-- google_calendar_connections
CREATE POLICY "Users can view own Google Calendar connection"
  ON public.google_calendar_connections FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own Google Calendar connection"
  ON public.google_calendar_connections FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own Google Calendar connection"
  ON public.google_calendar_connections FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own Google Calendar connection"
  ON public.google_calendar_connections FOR DELETE USING (auth.uid() = user_id);

-- google_calendar_sync_outbox
CREATE POLICY "Users can view own Google Calendar outbox"
  ON public.google_calendar_sync_outbox FOR SELECT USING (auth.uid() = user_id);

-- google_calendar_task_links
CREATE POLICY "Users can view own Google Calendar links"
  ON public.google_calendar_task_links FOR SELECT USING (auth.uid() = user_id);

-- ledger_entries
CREATE POLICY "Users can view own ledger"
  ON public.ledger_entries FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own ledger entries"
  ON public.ledger_entries FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Voucher can insert ledger entry for their task"
  ON public.ledger_entries FOR INSERT
  WITH CHECK (auth.uid() = (SELECT voucher_id FROM tasks WHERE id = task_id));

-- overrides
CREATE POLICY "Users can view own overrides"
  ON public.overrides FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own overrides"
  ON public.overrides FOR INSERT WITH CHECK (auth.uid() = user_id);

-- pomo_sessions
CREATE POLICY "Users can manage own pomo sessions"
  ON public.pomo_sessions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Friends can view active or paused pomo sessions"
  ON public.pomo_sessions FOR SELECT
  USING (
    status = ANY (ARRAY['ACTIVE','PAUSED'])
    AND EXISTS (
      SELECT 1 FROM friendships
      WHERE user_id = auth.uid() AND friend_id = pomo_sessions.user_id
    )
  );

-- profiles
CREATE POLICY "Users can view all profiles"
  ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- rectify_passes
CREATE POLICY "Users can view own rectify passes"
  ON public.rectify_passes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Vouchers can view authorized passes"
  ON public.rectify_passes FOR SELECT USING (auth.uid() = authorized_by);
CREATE POLICY "System can insert rectify passes"
  ON public.rectify_passes FOR INSERT WITH CHECK (true);

-- recurrence_rules
CREATE POLICY "Users can view own recurrence rules"
  ON public.recurrence_rules FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own recurrence rules"
  ON public.recurrence_rules FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own recurrence rules"
  ON public.recurrence_rules FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own recurrence rules"
  ON public.recurrence_rules FOR DELETE USING (auth.uid() = user_id);

-- task_completion_proofs
CREATE POLICY "Owners can view own task proofs"
  ON public.task_completion_proofs FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "Vouchers can view assigned task proofs"
  ON public.task_completion_proofs FOR SELECT USING (auth.uid() = voucher_id);
CREATE POLICY "Owners can insert own task proofs"
  ON public.task_completion_proofs FOR INSERT
  WITH CHECK (
    auth.uid() = owner_id
    AND EXISTS (SELECT 1 FROM tasks WHERE id = task_id AND user_id = auth.uid())
  );
CREATE POLICY "Owners can update own task proofs"
  ON public.task_completion_proofs FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Owners can delete own task proofs"
  ON public.task_completion_proofs FOR DELETE USING (auth.uid() = owner_id);

-- task_events
CREATE POLICY "Users can view events for own tasks"
  ON public.task_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM tasks
    WHERE id = task_id AND (user_id = auth.uid() OR voucher_id = auth.uid())
  ));
CREATE POLICY "System can insert events"
  ON public.task_events FOR INSERT WITH CHECK (true);

-- task_reminders
CREATE POLICY "Users can view own task reminders"
  ON public.task_reminders FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own task reminders"
  ON public.task_reminders FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own task reminders"
  ON public.task_reminders FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own task reminders"
  ON public.task_reminders FOR DELETE USING (auth.uid() = user_id);

-- task_subtasks
CREATE POLICY "Users can view own task subtasks"
  ON public.task_subtasks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own task subtasks"
  ON public.task_subtasks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own task subtasks"
  ON public.task_subtasks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own task subtasks"
  ON public.task_subtasks FOR DELETE USING (auth.uid() = user_id);

-- tasks
CREATE POLICY "Users can view own tasks"
  ON public.tasks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Vouchers can view assigned tasks"
  ON public.tasks FOR SELECT USING (auth.uid() = voucher_id);
CREATE POLICY "Users can create own tasks"
  ON public.tasks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own tasks"
  ON public.tasks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Vouchers can update assigned tasks"
  ON public.tasks FOR UPDATE
  USING (auth.uid() = voucher_id)
  WITH CHECK (auth.uid() = voucher_id AND status <> 'DELETED');

-- user_blocks
CREATE POLICY "Users can view own blocks"
  ON public.user_blocks FOR SELECT USING (auth.uid() = blocker_id);

-- user_client_instances
CREATE POLICY "Users can view own client instances"
  ON public.user_client_instances FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own client instances"
  ON public.user_client_instances FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own client instances"
  ON public.user_client_instances FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own client instances"
  ON public.user_client_instances FOR DELETE USING (auth.uid() = user_id);

-- voucher_reminder_logs
CREATE POLICY "Users can view own voucher reminder logs"
  ON public.voucher_reminder_logs FOR SELECT USING (auth.uid() = voucher_id);
CREATE POLICY "Users can insert own voucher reminder logs"
  ON public.voucher_reminder_logs FOR INSERT WITH CHECK (auth.uid() = voucher_id);

-- web_push_subscriptions
CREATE POLICY "Users can view their own subscriptions"
  ON public.web_push_subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own subscriptions"
  ON public.web_push_subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own subscriptions"
  ON public.web_push_subscriptions FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- REALTIME PUBLICATIONS
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.commitment_task_links;
ALTER PUBLICATION supabase_realtime ADD TABLE public.commitments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.friend_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.friendships;
ALTER PUBLICATION supabase_realtime ADD TABLE public.google_calendar_connections;
ALTER PUBLICATION supabase_realtime ADD TABLE public.google_calendar_sync_outbox;
ALTER PUBLICATION supabase_realtime ADD TABLE public.google_calendar_task_links;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pomo_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_blocks;
