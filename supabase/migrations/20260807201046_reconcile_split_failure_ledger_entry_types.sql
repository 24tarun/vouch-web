-- Production already uses a distinct ledger entry type for each kind of
-- failure. This repository was missing that migration, which made a fresh
-- local reset differ from the deployed schema.
ALTER TABLE public.ledger_entries
  DROP CONSTRAINT IF EXISTS ledger_entries_entry_type_check;

UPDATE public.ledger_entries AS le
SET entry_type = COALESCE((
  SELECT lower(e.to_status)
  FROM public.task_events AS e
  WHERE e.task_id = le.task_id
    AND e.to_status IN ('DENIED', 'MISSED', 'SURRENDERED')
  ORDER BY e.created_at DESC
  LIMIT 1
), 'missed')
WHERE le.entry_type = 'failure';

ALTER TABLE public.ledger_entries
  ADD CONSTRAINT ledger_entries_entry_type_check
  CHECK (entry_type IN (
    'denied', 'missed', 'surrendered', 'rectified', 'override',
    'voucher_timeout_penalty'
  ));

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
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_actor_user_client_instance_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_client_instances AS instance
    WHERE instance.id = p_actor_user_client_instance_id
      AND instance.user_id = v_user_id
  ) THEN RAISE EXCEPTION 'Invalid user client instance'; END IF;

  SELECT t.* INTO v_task FROM public.tasks AS t
  WHERE t.id = p_task_id AND t.user_id = v_user_id FOR UPDATE;
  IF v_task.id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF v_task.status NOT IN ('ACTIVE', 'POSTPONED') THEN
    RAISE EXCEPTION 'Task can no longer be surrendered';
  END IF;
  IF v_task.created_at > v_now - interval '1 hour' THEN
    RAISE EXCEPTION 'Tasks can only be surrendered after the 1 hour delete window expires';
  END IF;

  UPDATE public.tasks AS t
  SET status = 'SURRENDERED', proof_request_open = false,
      proof_requested_at = NULL, proof_requested_by = NULL, updated_at = v_now
  WHERE t.id = v_task.id AND t.user_id = v_user_id;

  INSERT INTO public.ledger_entries(user_id, task_id, period, amount_cents, entry_type)
  VALUES (
    v_user_id, v_task.id, to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM'),
    v_task.failure_cost_cents, 'surrendered'
  );

  INSERT INTO public.task_events(
    task_id, event_type, actor_id, actor_user_client_instance_id,
    from_status, to_status, metadata
  ) VALUES (
    v_task.id, 'SURRENDER', v_user_id, p_actor_user_client_instance_id,
    v_task.status, 'SURRENDERED',
    jsonb_build_object('reason', 'Voluntarily surrendered by task owner')
  );

  RETURN QUERY SELECT v_task.id, v_task.user_id, v_task.voucher_id,
    v_task.recurrence_rule_id, v_task.failure_cost_cents, v_task.status;
END;
$$;

REVOKE ALL ON FUNCTION public.surrender_task_atomic(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.surrender_task_atomic(uuid, uuid) TO authenticated;
