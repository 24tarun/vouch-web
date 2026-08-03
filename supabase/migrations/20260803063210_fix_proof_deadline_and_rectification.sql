-- Fix AI rectification approval failures caused by PL/pgSQL output-column
-- ambiguity, and make proof deadline validation atomic with finalization.

CREATE OR REPLACE FUNCTION public.check_rectify_pass_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF (
    SELECT count(*)
    FROM public.rectify_passes AS rp
    WHERE rp.user_id = NEW.user_id
      AND rp.period = NEW.period
  ) >= 5 THEN
    RAISE EXCEPTION 'Rectify pass limit of 5 per month reached for user % in period %',
      NEW.user_id, NEW.period;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.check_rectify_pass_limit()
FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION private.apply_rectification(
  p_request_id uuid,
  p_actor_id uuid,
  p_event_type text,
  p_resolution_state text,
  p_decision_reason text DEFAULT NULL
)
RETURNS TABLE (task_id uuid, owner_id uuid, original_voucher_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request public.rectification_requests%ROWTYPE;
  v_task public.tasks%ROWTYPE;
BEGIN
  SELECT rr.* INTO v_request
  FROM public.rectification_requests AS rr
  WHERE rr.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR NOT private.rectification_open_state(v_request.state) THEN
    RAISE EXCEPTION 'Rectification request is no longer open';
  END IF;

  SELECT t.* INTO v_task
  FROM public.tasks AS t
  WHERE t.id = v_request.task_id
  FOR UPDATE;

  IF v_task.status <> 'AWAITING_RECTIFICATION' THEN
    RAISE EXCEPTION 'Task is no longer awaiting rectification';
  END IF;

  INSERT INTO public.rectify_passes(user_id, task_id, authorized_by, period)
  SELECT v_request.owner_id, v_request.task_id, p_actor_id, v_request.request_period
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.rectify_passes AS rp
    WHERE rp.task_id = v_request.task_id
  );

  INSERT INTO public.ledger_entries(user_id, task_id, period, amount_cents, entry_type)
  SELECT v_request.owner_id, v_request.task_id, v_request.failure_period, -v_task.failure_cost_cents, 'rectified'
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.ledger_entries AS le
    WHERE le.task_id = v_request.task_id
      AND le.entry_type = 'rectified'
  );

  UPDATE public.tasks AS t
  SET status = 'RECTIFIED', updated_at = now(), proof_request_open = false,
      proof_requested_at = NULL, proof_requested_by = NULL
  WHERE t.id = v_request.task_id;

  UPDATE public.rectification_requests AS rr
  SET state = p_resolution_state, decision_reason = p_decision_reason,
      resolved_at = now(), updated_at = now()
  WHERE rr.id = p_request_id;

  UPDATE public.ai_rectification_usage AS aru
  SET state = 'consumed', consumed_at = COALESCE(aru.consumed_at, now()),
      reserved_at = NULL, released_at = NULL, updated_at = now()
  WHERE aru.request_id = p_request_id
    AND aru.state = 'reserved';

  INSERT INTO public.task_events(task_id, event_type, actor_id, from_status, to_status, metadata)
  VALUES (
    v_request.task_id, p_event_type, p_actor_id,
    'AWAITING_RECTIFICATION', 'RECTIFIED',
    jsonb_build_object('request_id', p_request_id, 'reason', p_decision_reason)
  );

  RETURN QUERY SELECT v_request.task_id, v_request.owner_id, v_request.original_voucher_id;
END;
$$;

REVOKE ALL ON FUNCTION private.apply_rectification(uuid, uuid, text, text, text)
FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.finalize_task_proof_atomic(
  p_task_id uuid,
  p_owner_id uuid,
  p_bucket text,
  p_object_path text,
  p_media_kind text,
  p_mime_type text,
  p_size_bytes integer,
  p_duration_ms integer,
  p_overlay_timestamp_text text,
  p_task_status text
)
RETURNS TABLE(success boolean, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := now();
  v_task_status text;
  v_task_deadline timestamptz;
  v_proof_id uuid;
  v_proof_staged_at timestamptz;
  v_event_type text;
  v_request_id uuid;
  v_proof_origin text;
  v_proof_timestamp_at timestamptz;
  v_proof_timestamp_source text;
  v_proof_timezone text;
BEGIN
  -- Lock the task first so completion, timeout, and proof finalization use a
  -- consistent lock order and cannot race on a stale status/deadline snapshot.
  SELECT t.status, t.deadline
  INTO v_task_status, v_task_deadline
  FROM public.tasks AS t
  WHERE t.id = p_task_id
    AND t.user_id = p_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Task not found.';
    RETURN;
  END IF;

  SELECT
    proof.id,
    proof.updated_at,
    proof.proof_origin,
    proof.proof_timestamp_at,
    proof.proof_timestamp_source,
    proof.proof_timezone
  INTO
    v_proof_id,
    v_proof_staged_at,
    v_proof_origin,
    v_proof_timestamp_at,
    v_proof_timestamp_source,
    v_proof_timezone
  FROM public.task_completion_proofs AS proof
  WHERE proof.task_id = p_task_id
    AND proof.owner_id = p_owner_id
    AND proof.bucket = p_bucket
    AND proof.object_path = p_object_path
    AND proof.upload_state = 'PENDING'
  FOR UPDATE;

  IF v_proof_id IS NULL THEN
    RETURN QUERY SELECT false, 'Proof record not found or not pending.';
    RETURN;
  END IF;

  IF v_task_status <> p_task_status THEN
    RETURN QUERY SELECT false, 'Task changed while proof was uploading.';
    RETURN;
  END IF;

  IF v_task_status NOT IN (
    'ACTIVE','POSTPONED','AWAITING_USER','AWAITING_VOUCHER','AWAITING_AI',
    'MARKED_COMPLETE','AWAITING_RECTIFICATION'
  ) THEN
    RETURN QUERY SELECT false, 'Task no longer accepts proof uploads.';
    RETURN;
  END IF;

  -- The displayed deadline minute is inclusive. Appeal and rectification
  -- proof follow their review workflows and are intentionally exempt here.
  IF v_task_status IN (
       'ACTIVE','POSTPONED','AWAITING_VOUCHER','AWAITING_AI','MARKED_COMPLETE'
     )
     AND (
       v_task_deadline IS NULL
       OR v_proof_staged_at IS NULL
       OR v_proof_staged_at >= v_task_deadline + interval '1 minute'
     ) THEN
    RETURN QUERY SELECT false,
      'The task deadline has passed. Proof and completion can no longer be changed.';
    RETURN;
  END IF;

  UPDATE public.task_completion_proofs AS proof
  SET media_kind = p_media_kind,
      mime_type = p_mime_type,
      size_bytes = p_size_bytes,
      duration_ms = p_duration_ms,
      overlay_timestamp_text = p_overlay_timestamp_text,
      upload_state = 'UPLOADED',
      updated_at = v_now
  WHERE proof.id = v_proof_id
    AND proof.owner_id = p_owner_id;

  UPDATE public.tasks AS t
  SET has_proof = true,
      proof_request_open = false,
      proof_requested_at = NULL,
      proof_requested_by = NULL,
      updated_at = v_now
  WHERE t.id = p_task_id
    AND t.user_id = p_owner_id
    AND t.status = v_task_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task changed while proof was uploading';
  END IF;

  IF v_task_status = 'AWAITING_RECTIFICATION' THEN
    SELECT rr.id INTO v_request_id
    FROM public.rectification_requests AS rr
    WHERE rr.task_id = p_task_id
      AND private.rectification_open_state(rr.state)
    ORDER BY rr.created_at DESC
    LIMIT 1;
    v_event_type := 'RECTIFICATION_PROOF_UPLOADED';
  ELSE
    v_event_type := 'PROOF_UPLOADED';
  END IF;

  INSERT INTO public.task_events(
    task_id,
    event_type,
    actor_id,
    from_status,
    to_status,
    metadata
  )
  VALUES (
    p_task_id,
    v_event_type,
    p_owner_id,
    v_task_status,
    v_task_status,
    jsonb_build_object(
      'request_id', v_request_id,
      'media_kind', p_media_kind,
      'mime_type', p_mime_type,
      'size_bytes', p_size_bytes,
      'duration_ms', p_duration_ms,
      'proof_origin', v_proof_origin,
      'proof_timestamp_at', v_proof_timestamp_at,
      'proof_timestamp_source', v_proof_timestamp_source,
      'proof_timezone', v_proof_timezone
    )
  );

  RETURN QUERY SELECT true, NULL::text;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_task_proof_atomic(
  uuid, uuid, text, text, text, text, integer, integer, text, text
) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.finalize_task_proof_atomic(
  uuid, uuid, text, text, text, text, integer, integer, text, text
) TO service_role;
