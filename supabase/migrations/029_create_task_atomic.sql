CREATE OR REPLACE FUNCTION public.create_task_atomic(
  p_voucher_id uuid,
  p_title text,
  p_creation_input text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_failure_cost_cents integer DEFAULT NULL,
  p_required_pomo_minutes integer DEFAULT NULL,
  p_requires_proof boolean DEFAULT false,
  p_deadline timestamptz DEFAULT NULL,
  p_start_at timestamptz DEFAULT NULL,
  p_is_strict boolean DEFAULT false,
  p_google_sync_for_task boolean DEFAULT false,
  p_google_event_start_at timestamptz DEFAULT NULL,
  p_google_event_end_at timestamptz DEFAULT NULL,
  p_google_event_color_id text DEFAULT NULL,
  p_created_by_user_client_instance_id uuid DEFAULT NULL,
  p_subtasks text[] DEFAULT ARRAY[]::text[],
  p_reminder_at timestamptz[] DEFAULT ARRAY[]::timestamptz[],
  p_reminder_sources text[] DEFAULT ARRAY[]::text[],
  p_recurrence_type text DEFAULT NULL,
  p_recurrence_interval integer DEFAULT 1,
  p_recurrence_days integer[] DEFAULT NULL,
  p_recurrence_timezone text DEFAULT NULL,
  p_recurrence_time_of_day text DEFAULT NULL,
  p_time_bound_for_rule boolean DEFAULT false,
  p_window_start_offset_minutes integer DEFAULT NULL,
  p_google_event_duration_minutes integer DEFAULT NULL,
  p_last_generated_date date DEFAULT NULL,
  p_manual_reminder_offsets_ms bigint[] DEFAULT ARRAY[]::bigint[]
)
RETURNS TABLE (task_id uuid, recurrence_rule_id uuid)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_task_id uuid;
  v_rule_id uuid := NULL;
  v_subtask text;
  v_subtasks text[] := COALESCE(p_subtasks, ARRAY[]::text[]);
  v_reminder_at timestamptz[] := COALESCE(p_reminder_at, ARRAY[]::timestamptz[]);
  v_reminder_sources text[] := COALESCE(p_reminder_sources, ARRAY[]::text[]);
  v_manual_reminder_offsets_ms bigint[] := COALESCE(p_manual_reminder_offsets_ms, ARRAY[]::bigint[]);
  v_manual_offsets_jsonb jsonb := NULL;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_title IS NULL OR char_length(btrim(p_title)) = 0 THEN
    RAISE EXCEPTION 'Title is required';
  END IF;

  IF char_length(btrim(p_title)) > 500 THEN
    RAISE EXCEPTION 'Title too long';
  END IF;

  IF p_voucher_id IS NULL THEN
    RAISE EXCEPTION 'Voucher is required';
  END IF;

  IF p_failure_cost_cents IS NULL THEN
    RAISE EXCEPTION 'Failure cost is required';
  END IF;

  IF p_deadline IS NULL THEN
    RAISE EXCEPTION 'Deadline is required';
  END IF;

  IF p_voucher_id <> v_user_id AND NOT EXISTS (
    SELECT 1
    FROM public.friendships
    WHERE user_id = v_user_id
      AND friend_id = p_voucher_id
  ) THEN
    RAISE EXCEPTION 'You can only assign yourself or friends as vouchers';
  END IF;

  IF COALESCE(array_length(v_subtasks, 1), 0) > 20 THEN
    RAISE EXCEPTION 'A task can have at most 20 subtasks.';
  END IF;

  FOREACH v_subtask IN ARRAY v_subtasks LOOP
    v_subtask := btrim(v_subtask);
    IF v_subtask = '' THEN
      RAISE EXCEPTION 'Subtask title cannot be empty.';
    END IF;
    IF char_length(v_subtask) > 500 THEN
      RAISE EXCEPTION 'Subtask title cannot exceed 500 characters.';
    END IF;
  END LOOP;

  IF COALESCE(array_length(v_reminder_at, 1), 0) <> COALESCE(array_length(v_reminder_sources, 1), 0) THEN
    RAISE EXCEPTION 'Reminder payload is invalid.';
  END IF;

  IF COALESCE(array_length(v_reminder_sources, 1), 0) > 0 AND EXISTS (
    SELECT 1
    FROM unnest(v_reminder_sources) AS source
    WHERE source NOT IN ('MANUAL', 'DEFAULT_DEADLINE_1H', 'DEFAULT_DEADLINE_10M')
  ) THEN
    RAISE EXCEPTION 'Reminder payload is invalid.';
  END IF;

  IF COALESCE(array_length(v_manual_reminder_offsets_ms, 1), 0) > 0 THEN
    v_manual_offsets_jsonb := to_jsonb(v_manual_reminder_offsets_ms);
  END IF;

  IF p_recurrence_type IS NOT NULL AND btrim(p_recurrence_type) <> '' THEN
    INSERT INTO public.recurrence_rules (
      user_id,
      voucher_id,
      title,
      description,
      failure_cost_cents,
      rule_config,
      timezone,
      last_generated_date,
      required_pomo_minutes,
      manual_reminder_offsets_ms,
      google_event_duration_minutes,
      google_sync_for_rule,
      google_event_color_id,
      requires_proof,
      time_bound_for_rule,
      window_start_offset_minutes
    )
    VALUES (
      v_user_id,
      p_voucher_id,
      btrim(p_title),
      p_description,
      p_failure_cost_cents,
      jsonb_strip_nulls(jsonb_build_object(
        'frequency', p_recurrence_type,
        'interval', COALESCE(p_recurrence_interval, 1),
        'days_of_week', CASE
          WHEN p_recurrence_days IS NULL THEN NULL
          ELSE to_jsonb(p_recurrence_days)
        END,
        'time_of_day', p_recurrence_time_of_day
      )),
      COALESCE(NULLIF(btrim(p_recurrence_timezone), ''), 'UTC'),
      p_last_generated_date,
      p_required_pomo_minutes,
      v_manual_offsets_jsonb,
      p_google_event_duration_minutes,
      p_google_sync_for_task,
      p_google_event_color_id,
      p_requires_proof,
      p_time_bound_for_rule,
      p_window_start_offset_minutes
    )
    RETURNING id INTO v_rule_id;
  END IF;

  INSERT INTO public.tasks (
    user_id,
    voucher_id,
    title,
    creation_input,
    description,
    failure_cost_cents,
    required_pomo_minutes,
    requires_proof,
    deadline,
    status,
    start_at,
    is_strict,
    google_sync_for_task,
    google_event_start_at,
    google_event_end_at,
    google_event_color_id,
    recurrence_rule_id,
    created_by_user_client_instance_id
  )
  VALUES (
    v_user_id,
    p_voucher_id,
    btrim(p_title),
    p_creation_input,
    p_description,
    p_failure_cost_cents,
    p_required_pomo_minutes,
    p_requires_proof,
    p_deadline,
    'ACTIVE',
    p_start_at,
    p_is_strict,
    p_google_sync_for_task,
    p_google_event_start_at,
    p_google_event_end_at,
    p_google_event_color_id,
    v_rule_id,
    p_created_by_user_client_instance_id
  )
  RETURNING id INTO v_task_id;

  IF COALESCE(array_length(v_subtasks, 1), 0) > 0 THEN
    INSERT INTO public.task_subtasks (
      parent_task_id,
      user_id,
      title,
      is_completed,
      completed_at
    )
    SELECT
      v_task_id,
      v_user_id,
      btrim(subtask_title),
      false,
      NULL
    FROM unnest(v_subtasks) AS subtask_title;
  END IF;

  IF COALESCE(array_length(v_reminder_at, 1), 0) > 0 THEN
    INSERT INTO public.task_reminders (
      parent_task_id,
      user_id,
      reminder_at,
      source,
      notified_at
    )
    SELECT
      v_task_id,
      v_user_id,
      v_reminder_at[idx],
      v_reminder_sources[idx],
      NULL
    FROM generate_subscripts(v_reminder_at, 1) AS idx;
  END IF;

  INSERT INTO public.task_events (
    task_id,
    event_type,
    actor_id,
    actor_user_client_instance_id,
    from_status,
    to_status,
    metadata
  )
  VALUES (
    v_task_id,
    'ACTIVE',
    v_user_id,
    p_created_by_user_client_instance_id,
    'ACTIVE',
    'ACTIVE',
    jsonb_build_object(
      'title', btrim(p_title),
      'deadline', p_deadline,
      'failure_cost_cents', p_failure_cost_cents,
      'recurrence_rule_id', v_rule_id,
      'reminder_count', COALESCE(array_length(v_reminder_at, 1), 0),
      'required_pomo_minutes', p_required_pomo_minutes,
      'requires_proof', p_requires_proof
    )
  );

  task_id := v_task_id;
  recurrence_rule_id := v_rule_id;
  RETURN NEXT;
END;
$$;
