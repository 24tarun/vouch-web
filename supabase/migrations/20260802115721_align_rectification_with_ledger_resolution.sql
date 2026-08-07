-- Rectification stays open until the ledger month resolves: 00:00 on the
-- third day of the following month in the owner's timezone.
UPDATE public.rectification_requests
SET auto_rectify_at = (
  (to_date(request_period || '-01', 'YYYY-MM-DD') + interval '1 month 2 days')::timestamp
  AT TIME ZONE owner_timezone
)
WHERE state IN ('PENDING_HUMAN', 'PENDING_AI', 'AWAITING_AI_APPEAL');

CREATE OR REPLACE FUNCTION public.request_task_rectification(
  p_task_id uuid,
  p_target_type text,
  p_reason text DEFAULT NULL,
  p_actor_user_client_instance_id uuid DEFAULT NULL
)
RETURNS SETOF public.rectification_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_task public.tasks%ROWTYPE;
  v_timezone text;
  v_period text;
  v_request_period text;
  v_failure_at timestamptz;
  v_month_boundary timestamptz;
  v_ledger_resolution_at timestamptz;
  v_request public.rectification_requests%ROWTYPE;
  v_target uuid;
  v_state text;
  v_used integer;
  v_reserved integer;
  v_tier text;
  v_ai_used integer;
  v_ai_pending integer;
  v_ai_profile constant uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text || ':rectification-pass', 0));

  SELECT * INTO v_task FROM public.tasks
  WHERE id = p_task_id AND user_id = v_actor
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF v_task.status NOT IN ('DENIED','MISSED','SURRENDERED') THEN
    RAISE EXCEPTION 'Task is not eligible for rectification';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.rectification_requests
    WHERE task_id = p_task_id AND state = 'DECLINED'
  ) THEN
    RAISE EXCEPTION 'Rectification was already declined for this task';
  END IF;

  SELECT COALESCE(timezone, 'UTC') INTO v_timezone
  FROM public.profiles WHERE id = v_actor;
  v_request_period := to_char(now() AT TIME ZONE v_timezone, 'YYYY-MM');
  SELECT period, created_at INTO v_period, v_failure_at
  FROM public.ledger_entries
  WHERE task_id = v_task.id AND user_id = v_actor
    AND entry_type IN ('denied', 'missed', 'surrendered')
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_period IS NULL THEN
    RAISE EXCEPTION 'Original failure ledger entry was not found';
  END IF;
  IF to_char(v_failure_at AT TIME ZONE v_timezone, 'YYYY-MM')
     <> v_request_period THEN
    RAISE EXCEPTION 'Rectification can only be requested in the failure month';
  END IF;

  SELECT count(*)::integer INTO v_used FROM public.rectify_passes
  WHERE user_id = v_actor AND period = v_request_period;
  SELECT count(*)::integer INTO v_reserved FROM public.rectification_requests
  WHERE owner_id = v_actor AND request_period = v_request_period
    AND private.rectification_open_state(state);
  IF v_used + v_reserved >= 5 THEN
    RAISE EXCEPTION 'All 5 rectification passes are used or reserved for this month';
  END IF;

  IF p_target_type = 'ORIGINAL_VOUCHER' THEN
    IF v_task.voucher_id IN (v_actor, v_ai_profile) THEN
      RAISE EXCEPTION 'This task has no eligible original human voucher';
    END IF;
    v_target := v_task.voucher_id;
    v_state := 'PENDING_HUMAN';
  ELSIF p_target_type = 'AI' THEN
    v_target := v_ai_profile;
    v_state := 'PENDING_AI';
  ELSE
    RAISE EXCEPTION 'Invalid rectification target';
  END IF;

  v_month_boundary := (
    date_trunc('month', now() AT TIME ZONE v_timezone) + interval '1 month'
  ) AT TIME ZONE v_timezone;
  v_ledger_resolution_at := v_month_boundary + interval '2 days';

  INSERT INTO public.rectification_requests(
    task_id, owner_id, original_voucher_id, target_voucher_id, target_type,
    original_status, failure_period, request_period, owner_timezone, reason, state, auto_rectify_at
  ) VALUES (
    v_task.id, v_actor, v_task.voucher_id, v_target, p_target_type,
    v_task.status, v_period, v_request_period, v_timezone, NULLIF(btrim(p_reason), ''), v_state,
    v_ledger_resolution_at
  ) RETURNING * INTO v_request;

  IF p_target_type = 'AI' THEN
    SELECT COALESCE(ue.account_tier, 'free') INTO v_tier
    FROM public.profiles p
    LEFT JOIN public.user_entitlements ue ON ue.user_id = p.id
    WHERE p.id = v_actor;
    SELECT count(*)::integer INTO v_ai_used
    FROM (
      SELECT task_id::text FROM public.ai_voucher_usage
      WHERE user_id = v_actor AND state = 'consumed'
        AND consumed_at >= v_month_boundary - interval '1 month'
        AND consumed_at < v_month_boundary
      UNION ALL
      SELECT request_id::text FROM public.ai_rectification_usage
      WHERE user_id = v_actor AND period = v_request_period AND state = 'consumed'
    ) used_rows;
    SELECT (
      (SELECT count(*) FROM public.ai_voucher_usage WHERE user_id = v_actor AND state = 'reserved')
      + (SELECT count(*) FROM public.ai_rectification_usage WHERE user_id = v_actor AND state = 'reserved')
    )::integer INTO v_ai_pending;
    IF v_tier = 'free' AND v_ai_used + v_ai_pending >= 5 THEN
      RAISE EXCEPTION 'AI_QUOTA_EXHAUSTED';
    END IF;
    INSERT INTO public.ai_rectification_usage(request_id, user_id, period, state, reserved_at)
    VALUES (v_request.id, v_actor, v_request_period, 'reserved', now());
  END IF;

  UPDATE public.tasks
  SET status = 'AWAITING_RECTIFICATION', updated_at = now(),
      proof_request_open = false, proof_requested_at = NULL, proof_requested_by = NULL
  WHERE id = v_task.id;

  INSERT INTO public.task_events(
    task_id, event_type, actor_id, actor_user_client_instance_id,
    from_status, to_status, metadata
  ) VALUES (
    v_task.id, 'RECTIFICATION_REQUESTED', v_actor, p_actor_user_client_instance_id,
    v_task.status, 'AWAITING_RECTIFICATION',
    jsonb_build_object('request_id', v_request.id, 'target_type', p_target_type, 'reason', v_request.reason)
  );

  RETURN NEXT v_request;
END;
$$;
