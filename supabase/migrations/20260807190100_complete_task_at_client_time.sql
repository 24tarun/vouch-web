
CREATE OR REPLACE FUNCTION public.complete_task_at_client_time(
  p_task_id                   uuid,
  p_client_action_at          timestamptz,
  p_next_status               text,
  p_voucher_response_deadline timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  max_client_lag  constant interval := interval '2 minutes';
  inclusive_minute constant interval := interval '1 minute';

  v_now             timestamptz := now();
  v_effective_at    timestamptz;
  v_task            public.tasks%ROWTYPE;
  v_proof_at        timestamptz;
  v_qualifying_at   timestamptz;
  v_updated_id      uuid;
BEGIN
  IF p_next_status NOT IN ('ACCEPTED', 'AWAITING_AI', 'AWAITING_VOUCHER', 'MARKED_COMPLETE') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid completion status.');
  END IF;

  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id AND user_id = auth.uid();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Task not found.');
  END IF;

  IF v_task.status NOT IN ('ACTIVE', 'POSTPONED') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Task can no longer be marked complete. Please refresh.');
  END IF;

  IF p_client_action_at IS NOT NULL
     AND p_client_action_at <= v_now
     AND v_now - p_client_action_at <= max_client_lag
  THEN
    v_effective_at := p_client_action_at;
  ELSE
    v_effective_at := v_now;
  END IF;

  SELECT proof.proof_timestamp_at INTO v_proof_at
  FROM public.task_completion_proofs AS proof
  WHERE proof.task_id = p_task_id
    AND proof.upload_state = 'UPLOADED'
    AND proof.object_path IS NOT NULL
    AND proof.proof_origin = 'CAMERA'
    AND proof.proof_timestamp_source = 'CAMERA_CAPTURE'
  ORDER BY proof.proof_timestamp_at ASC
  LIMIT 1;

  v_qualifying_at := LEAST(v_effective_at, COALESCE(v_proof_at, v_effective_at));

  IF v_task.deadline IS NULL
     OR v_qualifying_at >= v_task.deadline + inclusive_minute
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'The task deadline has passed. Proof and completion can no longer be changed.'
    );
  END IF;

  UPDATE public.tasks
  SET status                    = p_next_status,
      marked_completed_at       = v_effective_at,
      voucher_response_deadline = p_voucher_response_deadline,
      proof_request_open        = false,
      proof_requested_at        = NULL,
      proof_requested_by        = NULL,
      updated_at                = v_now
  WHERE id = p_task_id
    AND user_id = auth.uid()
    AND status IN ('ACTIVE', 'POSTPONED')
  RETURNING id INTO v_updated_id;

  IF v_updated_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Task can no longer be marked complete. Please refresh.');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'task_id', v_updated_id,
    'marked_completed_at', v_effective_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_task_at_client_time(uuid, timestamptz, text, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.complete_task_at_client_time(uuid, timestamptz, text, timestamptz) TO authenticated;
