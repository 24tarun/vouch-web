ALTER TABLE public.recurrence_rules
ADD COLUMN IF NOT EXISTS paused_at timestamptz;

ALTER TABLE public.task_events
DROP CONSTRAINT IF EXISTS task_events_event_type_check;

ALTER TABLE public.task_events
ADD CONSTRAINT task_events_event_type_check
CHECK (event_type = ANY (ARRAY[
  'ACTIVE','MARK_COMPLETE','UNDO_COMPLETE','PROOF_UPLOADED','PROOF_UPLOAD_FAILED_REVERT',
  'PROOF_REMOVED','PROOF_REQUESTED','VOUCHER_ACCEPT','VOUCHER_DENY','VOUCHER_DELETE',
  'RECTIFY','OVERRIDE','DEADLINE_MISSED','VOUCHER_TIMEOUT','POMO_COMPLETED',
  'DEADLINE_WARNING_1H','DEADLINE_WARNING_10M','DEADLINE_WARNING_DUE',
  'GOOGLE_EVENT_CANCELLED','POSTPONE',
  'REPETITION_STOPPED','REPETITION_PAUSED','REPETITION_RESUMED',
  'AI_APPROVE','AI_DENY','AI_DENIED','AI_DENIED_AUTO_HOP','ESCALATE',
  'AI_ESCALATE_TO_HUMAN','ACCEPT_DENIAL','RESUBMIT_TO_AI'
]));

CREATE OR REPLACE FUNCTION public.assign_recurrence_task_iteration_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.recurrence_rule_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.recurrence_rules
  SET
    latest_iteration = COALESCE(latest_iteration, 0) + 1,
    updated_at = now()
  WHERE id = NEW.recurrence_rule_id
    AND paused_at IS NULL
  RETURNING latest_iteration INTO NEW.iteration_number;

  IF NEW.iteration_number IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.recurrence_rules
      WHERE id = NEW.recurrence_rule_id
        AND paused_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION
        'Cannot create recurring task: recurrence rule % is paused',
        NEW.recurrence_rule_id;
    END IF;

    RAISE EXCEPTION
      'Cannot assign iteration number: recurrence rule % not found',
      NEW.recurrence_rule_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_recurrence_paused(
  p_task_id uuid,
  p_paused boolean,
  p_actor_user_client_instance_id uuid DEFAULT NULL
)
RETURNS TABLE (
  recurrence_rule_id uuid,
  paused_at timestamptz,
  state_changed boolean
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_rule_id uuid;
  v_task_status text;
  v_existing_paused_at timestamptz;
  v_result_paused_at timestamptz;
  v_timezone text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_actor_user_client_instance_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.user_client_instances
    WHERE id = p_actor_user_client_instance_id
      AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Invalid user client instance';
  END IF;

  SELECT
    rr.id,
    t.status,
    rr.paused_at,
    rr.timezone
  INTO
    v_rule_id,
    v_task_status,
    v_existing_paused_at,
    v_timezone
  FROM public.tasks t
  JOIN public.recurrence_rules rr ON rr.id = t.recurrence_rule_id
  WHERE t.id = p_task_id
    AND t.user_id = v_user_id
    AND rr.user_id = v_user_id
  FOR UPDATE OF rr;

  IF v_rule_id IS NULL THEN
    RAISE EXCEPTION 'Recurring task not found';
  END IF;

  IF p_paused = (v_existing_paused_at IS NOT NULL) THEN
    RETURN QUERY
    SELECT v_rule_id, v_existing_paused_at, false;
    RETURN;
  END IF;

  IF p_paused THEN
    v_result_paused_at := now();

    UPDATE public.recurrence_rules
    SET
      paused_at = v_result_paused_at,
      updated_at = v_result_paused_at
    WHERE id = v_rule_id
      AND user_id = v_user_id;
  ELSE
    v_result_paused_at := NULL;

    UPDATE public.recurrence_rules
    SET
      paused_at = NULL,
      last_generated_date = (now() AT TIME ZONE COALESCE(NULLIF(v_timezone, ''), 'UTC'))::date,
      updated_at = now()
    WHERE id = v_rule_id
      AND user_id = v_user_id;
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
    p_task_id,
    CASE WHEN p_paused THEN 'REPETITION_PAUSED' ELSE 'REPETITION_RESUMED' END,
    v_user_id,
    p_actor_user_client_instance_id,
    v_task_status,
    v_task_status,
    jsonb_build_object('recurrence_rule_id', v_rule_id)
  );

  RETURN QUERY
  SELECT v_rule_id, v_result_paused_at, true;
END;
$$;

REVOKE ALL ON FUNCTION public.set_recurrence_paused(uuid, boolean, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_recurrence_paused(uuid, boolean, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_recurrence_paused(uuid, boolean, uuid) TO authenticated;
