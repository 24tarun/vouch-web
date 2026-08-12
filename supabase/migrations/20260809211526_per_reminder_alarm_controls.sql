ALTER TABLE public.task_reminders
  ADD COLUMN IF NOT EXISTS alarm_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.recurrence_rules
  ADD COLUMN IF NOT EXISTS alarm_reminder_offsets_ms jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.recurrence_rules
  DROP CONSTRAINT IF EXISTS recurrence_rules_alarm_reminder_offsets_ms_is_array;

ALTER TABLE public.recurrence_rules
  ADD CONSTRAINT recurrence_rules_alarm_reminder_offsets_ms_is_array
  CHECK (jsonb_typeof(alarm_reminder_offsets_ms) = 'array');

-- Keep the original implementation available to the compatibility wrapper.
-- The wrapper remains the only create_task_atomic overload, so PostgREST does
-- not need to disambiguate old payloads from alarm-aware payloads.
ALTER FUNCTION public.create_task_atomic(
  uuid,
  text,
  text,
  text,
  integer,
  integer,
  boolean,
  timestamptz,
  timestamptz,
  boolean,
  boolean,
  timestamptz,
  timestamptz,
  text,
  uuid,
  text[],
  timestamptz[],
  text[],
  text,
  integer,
  integer[],
  text,
  text,
  boolean,
  integer,
  integer,
  date,
  bigint[]
) RENAME TO create_task_atomic_legacy;

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
  p_manual_reminder_offsets_ms bigint[] DEFAULT ARRAY[]::bigint[],
  p_reminder_alarm_enabled boolean[] DEFAULT ARRAY[]::boolean[]
)
RETURNS TABLE (task_id uuid, recurrence_rule_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_reminder_at timestamptz[] := COALESCE(p_reminder_at, ARRAY[]::timestamptz[]);
  v_alarm_flags boolean[] := COALESCE(p_reminder_alarm_enabled, ARRAY[]::boolean[]);
  v_task_id uuid;
  v_rule_id uuid;
BEGIN
  IF COALESCE(array_length(v_alarm_flags, 1), 0) NOT IN (
    0,
    COALESCE(array_length(v_reminder_at, 1), 0)
  ) THEN
    RAISE EXCEPTION 'Reminder alarm payload is invalid.';
  END IF;

  SELECT created.task_id, created.recurrence_rule_id
  INTO v_task_id, v_rule_id
  FROM public.create_task_atomic_legacy(
    p_voucher_id,
    p_title,
    p_creation_input,
    p_description,
    p_failure_cost_cents,
    p_required_pomo_minutes,
    p_requires_proof,
    p_deadline,
    p_start_at,
    p_is_strict,
    p_google_sync_for_task,
    p_google_event_start_at,
    p_google_event_end_at,
    p_google_event_color_id,
    p_created_by_user_client_instance_id,
    p_subtasks,
    p_reminder_at,
    p_reminder_sources,
    p_recurrence_type,
    p_recurrence_interval,
    p_recurrence_days,
    p_recurrence_timezone,
    p_recurrence_time_of_day,
    p_time_bound_for_rule,
    p_window_start_offset_minutes,
    p_google_event_duration_minutes,
    p_last_generated_date,
    p_manual_reminder_offsets_ms
  ) AS created;

  IF COALESCE(array_length(v_alarm_flags, 1), 0) > 0 THEN
    UPDATE public.task_reminders AS reminder
    SET alarm_enabled = COALESCE(v_alarm_flags[alarm_index.value], false)
    FROM generate_subscripts(v_reminder_at, 1) AS alarm_index(value)
    WHERE reminder.parent_task_id = v_task_id
      AND reminder.reminder_at = v_reminder_at[alarm_index.value];
  END IF;

  IF v_rule_id IS NOT NULL THEN
    UPDATE public.recurrence_rules AS rule
    SET alarm_reminder_offsets_ms = COALESCE((
      SELECT jsonb_agg(offsets.offset_ms ORDER BY offsets.offset_ms)
      FROM (
        SELECT DISTINCT
          ROUND(EXTRACT(EPOCH FROM (reminder.reminder_at - task.deadline)) * 1000)::bigint AS offset_ms
        FROM public.task_reminders AS reminder
        JOIN public.tasks AS task ON task.id = reminder.parent_task_id
        WHERE reminder.parent_task_id = v_task_id
          AND reminder.alarm_enabled = true
          AND reminder.reminder_at <= task.deadline
      ) AS offsets
    ), '[]'::jsonb)
    WHERE rule.id = v_rule_id
      AND rule.user_id = (SELECT auth.uid());
  END IF;

  task_id := v_task_id;
  recurrence_rule_id := v_rule_id;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_recurrence_reminder_offsets(p_task_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.recurrence_rules AS rule
  SET
    manual_reminder_offsets_ms = COALESCE((
      SELECT jsonb_agg(offsets.offset_ms ORDER BY offsets.offset_ms)
      FROM (
        SELECT DISTINCT
          ROUND(EXTRACT(EPOCH FROM (reminder.reminder_at - task.deadline)) * 1000)::bigint AS offset_ms
        FROM public.task_reminders AS reminder
        JOIN public.tasks AS task ON task.id = reminder.parent_task_id
        WHERE reminder.parent_task_id = p_task_id
          AND reminder.source = 'MANUAL'
          AND reminder.reminder_at <= task.deadline
      ) AS offsets
    ), '[]'::jsonb),
    alarm_reminder_offsets_ms = COALESCE((
      SELECT jsonb_agg(offsets.offset_ms ORDER BY offsets.offset_ms)
      FROM (
        SELECT DISTINCT
          ROUND(EXTRACT(EPOCH FROM (reminder.reminder_at - task.deadline)) * 1000)::bigint AS offset_ms
        FROM public.task_reminders AS reminder
        JOIN public.tasks AS task ON task.id = reminder.parent_task_id
        WHERE reminder.parent_task_id = p_task_id
          AND reminder.alarm_enabled = true
          AND reminder.reminder_at <= task.deadline
      ) AS offsets
    ), '[]'::jsonb)
  FROM public.tasks AS task
  WHERE task.id = p_task_id
    AND task.user_id = v_user_id
    AND task.recurrence_rule_id = rule.id
    AND rule.user_id = v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_task_reminder(
  p_task_id uuid,
  p_reminder_at timestamptz,
  p_alarm_enabled boolean DEFAULT false
)
RETURNS public.task_reminders
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_task public.tasks;
  v_reminder public.task_reminders;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT task.*
  INTO v_task
  FROM public.tasks AS task
  WHERE task.id = p_task_id
    AND task.user_id = v_user_id
    AND task.status IN ('ACTIVE', 'POSTPONED')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task is not editable.';
  END IF;

  IF p_reminder_at IS NULL OR p_reminder_at <= NOW() OR p_reminder_at >= v_task.deadline THEN
    RAISE EXCEPTION 'Reminder must be in the future and earlier than the task deadline.';
  END IF;

  INSERT INTO public.task_reminders (
    parent_task_id,
    user_id,
    reminder_at,
    source,
    notified_at,
    alarm_enabled
  )
  VALUES (
    p_task_id,
    v_user_id,
    p_reminder_at,
    'MANUAL',
    NULL,
    COALESCE(p_alarm_enabled, false)
  )
  RETURNING * INTO v_reminder;

  PERFORM public.refresh_recurrence_reminder_offsets(p_task_id);
  RETURN v_reminder;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_task_reminder_alarm(
  p_reminder_id uuid,
  p_alarm_enabled boolean
)
RETURNS public.task_reminders
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_reminder public.task_reminders;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.task_reminders AS reminder
  SET alarm_enabled = COALESCE(p_alarm_enabled, false)
  FROM public.tasks AS task
  WHERE reminder.id = p_reminder_id
    AND reminder.user_id = v_user_id
    AND reminder.parent_task_id = task.id
    AND task.user_id = v_user_id
    AND task.status IN ('ACTIVE', 'POSTPONED')
    AND reminder.notified_at IS NULL
    AND reminder.reminder_at > NOW()
  RETURNING reminder.* INTO v_reminder;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reminder is not editable.';
  END IF;

  PERFORM public.refresh_recurrence_reminder_offsets(v_reminder.parent_task_id);
  RETURN v_reminder;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_task_reminder(p_reminder_id uuid)
RETURNS public.task_reminders
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_reminder public.task_reminders;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM public.task_reminders AS reminder
  USING public.tasks AS task
  WHERE reminder.id = p_reminder_id
    AND reminder.user_id = v_user_id
    AND reminder.parent_task_id = task.id
    AND task.user_id = v_user_id
    AND task.status IN ('ACTIVE', 'POSTPONED')
  RETURNING reminder.* INTO v_reminder;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reminder is not editable.';
  END IF;

  PERFORM public.refresh_recurrence_reminder_offsets(v_reminder.parent_task_id);
  RETURN v_reminder;
END;
$$;

REVOKE ALL ON FUNCTION public.create_task_atomic_legacy(
  uuid, text, text, text, integer, integer, boolean, timestamptz, timestamptz,
  boolean, boolean, timestamptz, timestamptz, text, uuid, text[], timestamptz[],
  text[], text, integer, integer[], text, text, boolean, integer, integer, date,
  bigint[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_task_atomic_legacy(
  uuid, text, text, text, integer, integer, boolean, timestamptz, timestamptz,
  boolean, boolean, timestamptz, timestamptz, text, uuid, text[], timestamptz[],
  text[], text, integer, integer[], text, text, boolean, integer, integer, date,
  bigint[]
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_task_atomic(
  uuid, text, text, text, integer, integer, boolean, timestamptz, timestamptz,
  boolean, boolean, timestamptz, timestamptz, text, uuid, text[], timestamptz[],
  text[], text, integer, integer[], text, text, boolean, integer, integer, date,
  bigint[], boolean[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_task_atomic(
  uuid, text, text, text, integer, integer, boolean, timestamptz, timestamptz,
  boolean, boolean, timestamptz, timestamptz, text, uuid, text[], timestamptz[],
  text[], text, integer, integer[], text, text, boolean, integer, integer, date,
  bigint[], boolean[]
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.refresh_recurrence_reminder_offsets(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_recurrence_reminder_offsets(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.add_task_reminder(uuid, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_task_reminder(uuid, timestamptz, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.set_task_reminder_alarm(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_task_reminder_alarm(uuid, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_task_reminder(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_task_reminder(uuid) TO authenticated;
