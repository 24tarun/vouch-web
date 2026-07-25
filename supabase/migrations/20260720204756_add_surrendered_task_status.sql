ALTER TABLE public.tasks
DROP CONSTRAINT IF EXISTS tasks_status_check;

ALTER TABLE public.tasks
ADD CONSTRAINT tasks_status_check
CHECK (status = ANY (ARRAY[
  'ACTIVE','POSTPONED','MARKED_COMPLETE','AWAITING_VOUCHER','AWAITING_AI',
  'AI_DENIED','AWAITING_USER','ESCALATED','ACCEPTED','AUTO_ACCEPTED',
  'AI_ACCEPTED','DENIED','MISSED','SURRENDERED','RECTIFIED','SETTLED','DELETED'
]));

ALTER TABLE public.task_events
DROP CONSTRAINT IF EXISTS task_events_event_type_check;

ALTER TABLE public.task_events
ADD CONSTRAINT task_events_event_type_check
CHECK (event_type = ANY (ARRAY[
  'ACTIVE','MARK_COMPLETE','UNDO_COMPLETE','PROOF_UPLOADED','PROOF_UPLOAD_FAILED_REVERT',
  'PROOF_REMOVED','PROOF_REQUESTED','VOUCHER_ACCEPT','VOUCHER_DENY','VOUCHER_DELETE',
  'RECTIFY','OVERRIDE','DEADLINE_MISSED','SURRENDER','VOUCHER_TIMEOUT','POMO_COMPLETED',
  'DEADLINE_WARNING_1H','DEADLINE_WARNING_10M','DEADLINE_WARNING_DUE',
  'GOOGLE_EVENT_CANCELLED','POSTPONE',
  'REPETITION_STOPPED','REPETITION_PAUSED','REPETITION_RESUMED',
  'AI_APPROVE','AI_DENY','AI_DENIED','AI_DENIED_AUTO_HOP','ESCALATE',
  'AI_ESCALATE_TO_HUMAN','ACCEPT_DENIAL','RESUBMIT_TO_AI'
]));

ALTER TABLE public.task_events
DROP CONSTRAINT IF EXISTS task_events_from_status_check;

ALTER TABLE public.task_events
ADD CONSTRAINT task_events_from_status_check
CHECK (from_status = ANY (ARRAY[
  'ACTIVE','POSTPONED','MARKED_COMPLETE','AWAITING_VOUCHER','AWAITING_AI',
  'AI_DENIED','AWAITING_USER','ESCALATED','ACCEPTED','AUTO_ACCEPTED',
  'AI_ACCEPTED','DENIED','MISSED','SURRENDERED','RECTIFIED','SETTLED','DELETED'
]));

ALTER TABLE public.task_events
DROP CONSTRAINT IF EXISTS task_events_to_status_check;

ALTER TABLE public.task_events
ADD CONSTRAINT task_events_to_status_check
CHECK (to_status = ANY (ARRAY[
  'ACTIVE','POSTPONED','MARKED_COMPLETE','AWAITING_VOUCHER','AWAITING_AI',
  'AI_DENIED','AWAITING_USER','ESCALATED','ACCEPTED','AUTO_ACCEPTED',
  'AI_ACCEPTED','DENIED','MISSED','SURRENDERED','RECTIFIED','SETTLED','DELETED'
]));

CREATE OR REPLACE FUNCTION public.delete_reminders_on_final_task_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN (
    'ACCEPTED', 'AUTO_ACCEPTED', 'AI_ACCEPTED',
    'DENIED', 'MISSED', 'SURRENDERED', 'RECTIFIED', 'SETTLED', 'DELETED'
  ) AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    DELETE FROM public.task_reminders
    WHERE parent_task_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.surrender_task_atomic(
  p_task_id uuid,
  p_actor_user_client_instance_id uuid DEFAULT NULL
)
RETURNS TABLE (
  task_id uuid,
  user_id uuid,
  voucher_id uuid,
  recurrence_rule_id uuid,
  failure_cost_cents integer,
  previous_status text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_task public.tasks%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_actor_user_client_instance_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.user_client_instances
    WHERE public.user_client_instances.id = p_actor_user_client_instance_id
      AND public.user_client_instances.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Invalid user client instance';
  END IF;

  SELECT *
  INTO v_task
  FROM public.tasks
  WHERE public.tasks.id = p_task_id
    AND public.tasks.user_id = v_user_id
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  IF v_task.status NOT IN ('ACTIVE', 'POSTPONED') THEN
    RAISE EXCEPTION 'Task can no longer be surrendered';
  END IF;

  IF v_task.created_at > v_now - interval '1 hour' THEN
    RAISE EXCEPTION 'Tasks can only be surrendered after the 1 hour delete window expires';
  END IF;

  UPDATE public.tasks
  SET
    status = 'SURRENDERED',
    proof_request_open = false,
    proof_requested_at = NULL,
    proof_requested_by = NULL,
    updated_at = v_now
  WHERE id = v_task.id
    AND public.tasks.user_id = v_user_id;

  INSERT INTO public.ledger_entries (
    user_id,
    task_id,
    period,
    amount_cents,
    entry_type
  )
  VALUES (
    v_user_id,
    v_task.id,
    to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM'),
    v_task.failure_cost_cents,
    'failure'
  );

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
    v_task.id,
    'SURRENDER',
    v_user_id,
    p_actor_user_client_instance_id,
    v_task.status,
    'SURRENDERED',
    jsonb_build_object('reason', 'Voluntarily surrendered by task owner')
  );

  RETURN QUERY
  SELECT
    v_task.id,
    v_task.user_id,
    v_task.voucher_id,
    v_task.recurrence_rule_id,
    v_task.failure_cost_cents,
    v_task.status;
END;
$$;

REVOKE ALL ON FUNCTION public.surrender_task_atomic(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.surrender_task_atomic(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.surrender_task_atomic(uuid, uuid) TO authenticated;
