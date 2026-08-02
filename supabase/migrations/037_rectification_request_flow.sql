-- Owner-initiated rectification requests shared by web and mobile.
-- All mutating RPCs are SECURITY DEFINER because authenticated clients only
-- receive SELECT access to the request tables. Every RPC performs explicit
-- actor and state checks and has PUBLIC/anon execution revoked below.

ALTER TABLE public.tasks
DROP CONSTRAINT IF EXISTS tasks_status_check;

ALTER TABLE public.tasks
ADD CONSTRAINT tasks_status_check
CHECK (status = ANY (ARRAY[
  'ACTIVE','POSTPONED','MARKED_COMPLETE','AWAITING_VOUCHER','AWAITING_AI',
  'AI_DENIED','AWAITING_USER','ESCALATED','AWAITING_RECTIFICATION',
  'ACCEPTED','AUTO_ACCEPTED','AI_ACCEPTED','DENIED','MISSED','SURRENDERED',
  'RECTIFIED','SETTLED','DELETED'
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
  'GOOGLE_EVENT_CANCELLED','POSTPONE','REPETITION_STOPPED','REPETITION_PAUSED',
  'REPETITION_RESUMED','AI_APPROVE','AI_DENY','AI_DENIED','AI_DENIED_AUTO_HOP',
  'ESCALATE','AI_ESCALATE_TO_HUMAN','ACCEPT_DENIAL','RESUBMIT_TO_AI',
  'RECTIFICATION_REQUESTED','RECTIFICATION_UPDATED','RECTIFICATION_PROOF_REQUESTED',
  'RECTIFICATION_PROOF_UPLOADED','RECTIFICATION_CANCELLED','RECTIFICATION_DECLINED',
  'RECTIFICATION_AI_DENIED','RECTIFICATION_AI_APPEALED','RECTIFICATION_ESCALATED',
  'RECTIFICATION_APPROVED','RECTIFICATION_AUTO_APPROVED'
]));

ALTER TABLE public.task_events
DROP CONSTRAINT IF EXISTS task_events_from_status_check;

ALTER TABLE public.task_events
ADD CONSTRAINT task_events_from_status_check
CHECK (from_status = ANY (ARRAY[
  'ACTIVE','POSTPONED','MARKED_COMPLETE','AWAITING_VOUCHER','AWAITING_AI',
  'AI_DENIED','AWAITING_USER','ESCALATED','AWAITING_RECTIFICATION',
  'ACCEPTED','AUTO_ACCEPTED','AI_ACCEPTED','DENIED','MISSED','SURRENDERED',
  'RECTIFIED','SETTLED','DELETED'
]));

ALTER TABLE public.task_events
DROP CONSTRAINT IF EXISTS task_events_to_status_check;

ALTER TABLE public.task_events
ADD CONSTRAINT task_events_to_status_check
CHECK (to_status = ANY (ARRAY[
  'ACTIVE','POSTPONED','MARKED_COMPLETE','AWAITING_VOUCHER','AWAITING_AI',
  'AI_DENIED','AWAITING_USER','ESCALATED','AWAITING_RECTIFICATION',
  'ACCEPTED','AUTO_ACCEPTED','AI_ACCEPTED','DENIED','MISSED','SURRENDERED',
  'RECTIFIED','SETTLED','DELETED'
]));

CREATE TABLE public.rectification_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  original_voucher_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_voucher_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('ORIGINAL_VOUCHER', 'AI')),
  original_status text NOT NULL CHECK (original_status IN ('DENIED', 'MISSED', 'SURRENDERED')),
  failure_period text NOT NULL CHECK (failure_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  request_period text NOT NULL CHECK (request_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  owner_timezone text NOT NULL DEFAULT 'UTC',
  reason text,
  state text NOT NULL DEFAULT 'PENDING_HUMAN' CHECK (state IN (
    'PENDING_HUMAN','PENDING_AI','AWAITING_AI_APPEAL',
    'APPROVED','AUTO_APPROVED','DECLINED','CANCELLED'
  )),
  auto_rectify_at timestamptz NOT NULL,
  ai_appeal_count integer NOT NULL DEFAULT 0 CHECK (ai_appeal_count BETWEEN 0 AND 3),
  ai_attempt_count integer NOT NULL DEFAULT 0 CHECK (ai_attempt_count BETWEEN 0 AND 4),
  proof_requested_at timestamptz,
  proof_requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decision_reason text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((resolved_at IS NULL) = (state IN ('PENDING_HUMAN','PENDING_AI','AWAITING_AI_APPEAL')))
);

CREATE UNIQUE INDEX rectification_requests_one_open_per_task
  ON public.rectification_requests(task_id)
  WHERE state IN ('PENDING_HUMAN','PENDING_AI','AWAITING_AI_APPEAL');
CREATE INDEX rectification_requests_owner_period_idx
  ON public.rectification_requests(owner_id, request_period, state);
CREATE INDEX rectification_requests_target_state_idx
  ON public.rectification_requests(target_voucher_id, state, updated_at DESC);
CREATE INDEX rectification_requests_due_idx
  ON public.rectification_requests(auto_rectify_at)
  WHERE state IN ('PENDING_HUMAN','PENDING_AI','AWAITING_AI_APPEAL');

CREATE TABLE public.ai_rectification_usage (
  request_id uuid PRIMARY KEY REFERENCES public.rectification_requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','consumed','released')),
  reserved_at timestamptz,
  consumed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (state = 'reserved' AND reserved_at IS NOT NULL AND consumed_at IS NULL AND released_at IS NULL)
    OR (state = 'consumed' AND consumed_at IS NOT NULL AND released_at IS NULL)
    OR (state = 'released' AND consumed_at IS NULL AND released_at IS NOT NULL)
  )
);

CREATE INDEX ai_rectification_usage_user_period_state_idx
  ON public.ai_rectification_usage(user_id, period, state);

ALTER TABLE public.rectification_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_rectification_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Rectification participants can view requests"
  ON public.rectification_requests FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) = owner_id
    OR (SELECT auth.uid()) = target_voucher_id
  );

CREATE POLICY "Users can view own AI rectification usage"
  ON public.ai_rectification_usage FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.rectification_requests FROM public, anon, authenticated;
REVOKE ALL ON public.ai_rectification_usage FROM public, anon, authenticated;
GRANT SELECT ON public.rectification_requests TO authenticated;
GRANT SELECT ON public.ai_rectification_usage TO authenticated;
GRANT ALL ON public.rectification_requests TO service_role;
GRANT ALL ON public.ai_rectification_usage TO service_role;

-- Friendship removal treats only open human-targeted rectification requests as
-- relationship conflicts. AI-targeted requests intentionally do not block it.
CREATE OR REPLACE FUNCTION public.has_pending_voucher_conflict(p_user_a uuid, p_user_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.status = ANY (ARRAY[
      'ACTIVE','POSTPONED','MARKED_COMPLETE','AWAITING_VOUCHER',
      'AWAITING_AI','AWAITING_USER','ESCALATED'
    ]::text[])
    AND (
      (t.user_id = p_user_a AND t.voucher_id = p_user_b)
      OR (t.user_id = p_user_b AND t.voucher_id = p_user_a)
    )
  ) OR EXISTS (
    SELECT 1 FROM public.rectification_requests r
    WHERE r.target_type = 'ORIGINAL_VOUCHER'
      AND r.state IN ('PENDING_HUMAN','PENDING_AI','AWAITING_AI_APPEAL')
      AND (
        (r.owner_id = p_user_a AND r.target_voucher_id = p_user_b)
        OR (r.owner_id = p_user_b AND r.target_voucher_id = p_user_a)
      )
  );
$$;
REVOKE ALL ON FUNCTION public.has_pending_voucher_conflict(uuid, uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION private.rectification_open_state(p_state text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_state IN ('PENDING_HUMAN','PENDING_AI','AWAITING_AI_APPEAL');
$$;

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
  SELECT * INTO v_request
  FROM public.rectification_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR NOT private.rectification_open_state(v_request.state) THEN
    RAISE EXCEPTION 'Rectification request is no longer open';
  END IF;

  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = v_request.task_id
  FOR UPDATE;

  IF v_task.status <> 'AWAITING_RECTIFICATION' THEN
    RAISE EXCEPTION 'Task is no longer awaiting rectification';
  END IF;

  INSERT INTO public.rectify_passes(user_id, task_id, authorized_by, period)
  SELECT v_request.owner_id, v_request.task_id, p_actor_id, v_request.request_period
  WHERE NOT EXISTS (SELECT 1 FROM public.rectify_passes WHERE task_id = v_request.task_id);

  INSERT INTO public.ledger_entries(user_id, task_id, period, amount_cents, entry_type)
  SELECT v_request.owner_id, v_request.task_id, v_request.failure_period, -v_task.failure_cost_cents, 'rectified'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.ledger_entries WHERE task_id = v_request.task_id AND entry_type = 'rectified'
  );

  UPDATE public.tasks
  SET status = 'RECTIFIED', updated_at = now(), proof_request_open = false,
      proof_requested_at = NULL, proof_requested_by = NULL
  WHERE id = v_request.task_id;

  UPDATE public.rectification_requests
  SET state = p_resolution_state, decision_reason = p_decision_reason,
      resolved_at = now(), updated_at = now()
  WHERE id = p_request_id;

  UPDATE public.ai_rectification_usage
  SET state = 'consumed', consumed_at = COALESCE(consumed_at, now()),
      reserved_at = NULL, released_at = NULL, updated_at = now()
  WHERE request_id = p_request_id AND state = 'reserved';

  INSERT INTO public.task_events(task_id, event_type, actor_id, from_status, to_status, metadata)
  VALUES (
    v_request.task_id, p_event_type, p_actor_id,
    'AWAITING_RECTIFICATION', 'RECTIFIED',
    jsonb_build_object('request_id', p_request_id, 'reason', p_decision_reason)
  );

  RETURN QUERY SELECT v_request.task_id, v_request.owner_id, v_request.original_voucher_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.decline_rectification(
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
BEGIN
  SELECT * INTO v_request
  FROM public.rectification_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR NOT private.rectification_open_state(v_request.state) THEN
    RAISE EXCEPTION 'Rectification request is no longer open';
  END IF;

  UPDATE public.tasks
  SET status = v_request.original_status, updated_at = now(), has_proof = false,
      proof_request_open = false, proof_requested_at = NULL, proof_requested_by = NULL
  WHERE id = v_request.task_id AND status = 'AWAITING_RECTIFICATION';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task is no longer awaiting rectification';
  END IF;

  UPDATE public.rectification_requests
  SET state = p_resolution_state, decision_reason = p_decision_reason,
      resolved_at = now(), updated_at = now()
  WHERE id = p_request_id;

  UPDATE public.ai_rectification_usage
  SET state = 'released', reserved_at = NULL, released_at = now(), updated_at = now()
  WHERE request_id = p_request_id AND state = 'reserved';

  INSERT INTO public.task_events(task_id, event_type, actor_id, from_status, to_status, metadata)
  VALUES (
    v_request.task_id, p_event_type, p_actor_id,
    'AWAITING_RECTIFICATION', v_request.original_status,
    jsonb_build_object('request_id', p_request_id, 'reason', p_decision_reason)
  );

  RETURN QUERY SELECT v_request.task_id, v_request.owner_id, v_request.original_voucher_id;
END;
$$;

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
  WHERE task_id = v_task.id AND user_id = v_actor AND entry_type = 'failure'
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

  INSERT INTO public.rectification_requests(
    task_id, owner_id, original_voucher_id, target_voucher_id, target_type,
    original_status, failure_period, request_period, owner_timezone, reason, state, auto_rectify_at
  ) VALUES (
    v_task.id, v_actor, v_task.voucher_id, v_target, p_target_type,
    v_task.status, v_period, v_request_period, v_timezone, NULLIF(btrim(p_reason), ''), v_state,
    GREATEST(v_month_boundary, now() + interval '48 hours')
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

CREATE OR REPLACE FUNCTION public.update_task_rectification(
  p_request_id uuid,
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
  v_request public.rectification_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM public.rectification_requests
  WHERE id = p_request_id AND owner_id = v_actor
  FOR UPDATE;
  IF NOT FOUND OR NOT private.rectification_open_state(v_request.state) THEN
    RAISE EXCEPTION 'Rectification request is not editable';
  END IF;
  UPDATE public.rectification_requests
  SET reason = NULLIF(btrim(p_reason), ''), updated_at = now()
  WHERE id = p_request_id RETURNING * INTO v_request;
  INSERT INTO public.task_events(task_id, event_type, actor_id, actor_user_client_instance_id, from_status, to_status, metadata)
  VALUES (v_request.task_id, 'RECTIFICATION_UPDATED', v_actor, p_actor_user_client_instance_id,
          'AWAITING_RECTIFICATION', 'AWAITING_RECTIFICATION', jsonb_build_object('request_id', p_request_id));
  RETURN NEXT v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_task_rectification(
  p_request_id uuid,
  p_actor_user_client_instance_id uuid DEFAULT NULL
)
RETURNS SETOF public.rectification_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_request public.rectification_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM public.rectification_requests
  WHERE id = p_request_id AND owner_id = v_actor
  FOR UPDATE;
  IF NOT FOUND OR NOT private.rectification_open_state(v_request.state) THEN
    RAISE EXCEPTION 'Rectification request is not cancellable';
  END IF;
  PERFORM private.decline_rectification(p_request_id, v_actor, 'RECTIFICATION_CANCELLED', 'CANCELLED', NULL);
  SELECT * INTO v_request FROM public.rectification_requests WHERE id = p_request_id;
  RETURN NEXT v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_rectification_proof(
  p_request_id uuid,
  p_actor_user_client_instance_id uuid DEFAULT NULL
)
RETURNS SETOF public.rectification_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_request public.rectification_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM public.rectification_requests
  WHERE id = p_request_id AND target_type = 'ORIGINAL_VOUCHER'
    AND target_voucher_id = v_actor AND state = 'PENDING_HUMAN'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rectification request is not reviewable'; END IF;
  UPDATE public.rectification_requests
  SET proof_requested_at = now(), proof_requested_by = v_actor, updated_at = now()
  WHERE id = p_request_id RETURNING * INTO v_request;
  UPDATE public.tasks SET proof_request_open = true, proof_requested_at = now(), proof_requested_by = v_actor
  WHERE id = v_request.task_id AND status = 'AWAITING_RECTIFICATION';
  INSERT INTO public.task_events(task_id, event_type, actor_id, actor_user_client_instance_id, from_status, to_status, metadata)
  VALUES (v_request.task_id, 'RECTIFICATION_PROOF_REQUESTED', v_actor, p_actor_user_client_instance_id,
          'AWAITING_RECTIFICATION', 'AWAITING_RECTIFICATION', jsonb_build_object('request_id', p_request_id));
  RETURN NEXT v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_task_rectification(
  p_request_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL,
  p_actor_user_client_instance_id uuid DEFAULT NULL
)
RETURNS TABLE (task_id uuid, owner_id uuid, resolution text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_request public.rectification_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM public.rectification_requests
  WHERE id = p_request_id AND target_type = 'ORIGINAL_VOUCHER'
    AND target_voucher_id = v_actor AND state = 'PENDING_HUMAN'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rectification request is not reviewable'; END IF;
  IF p_decision = 'APPROVE' THEN
    PERFORM private.apply_rectification(p_request_id, v_actor, 'RECTIFICATION_APPROVED', 'APPROVED', p_reason);
    RETURN QUERY SELECT v_request.task_id, v_request.owner_id, 'APPROVED'::text;
  ELSIF p_decision = 'DECLINE' THEN
    PERFORM private.decline_rectification(p_request_id, v_actor, 'RECTIFICATION_DECLINED', 'DECLINED', p_reason);
    RETURN QUERY SELECT v_request.task_id, v_request.owner_id, 'DECLINED'::text;
  ELSE
    RAISE EXCEPTION 'Invalid rectification decision';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.authorize_task_rectification(
  p_task_id uuid,
  p_actor_user_client_instance_id uuid DEFAULT NULL
)
RETURNS TABLE (task_id uuid, owner_id uuid)
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
  v_used integer;
  v_reserved integer;
BEGIN
  SELECT * INTO v_task FROM public.tasks
  WHERE id = p_task_id AND voucher_id = v_actor AND user_id <> v_actor
  FOR UPDATE;
  IF NOT FOUND OR v_task.status NOT IN ('DENIED','MISSED','SURRENDERED') THEN
    RAISE EXCEPTION 'Task is not eligible for direct rectification';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_task.user_id::text || ':rectification-pass', 0));
  SELECT COALESCE(timezone, 'UTC') INTO v_timezone FROM public.profiles WHERE id = v_task.user_id;
  v_request_period := to_char(now() AT TIME ZONE v_timezone, 'YYYY-MM');
  SELECT period, created_at INTO v_period, v_failure_at
  FROM public.ledger_entries
  WHERE task_id = v_task.id AND user_id = v_task.user_id AND entry_type = 'failure'
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_period IS NULL THEN RAISE EXCEPTION 'Original failure ledger entry was not found'; END IF;
  IF to_char(v_failure_at AT TIME ZONE v_timezone, 'YYYY-MM')
     <> v_request_period THEN
    RAISE EXCEPTION 'Rectification can only be authorized in the failure month';
  END IF;
  SELECT count(*)::integer INTO v_used FROM public.rectify_passes WHERE user_id = v_task.user_id AND period = v_request_period;
  SELECT count(*)::integer INTO v_reserved FROM public.rectification_requests
  WHERE owner_id = v_task.user_id AND request_period = v_request_period AND private.rectification_open_state(state);
  IF v_used + v_reserved >= 5 THEN RAISE EXCEPTION 'All 5 rectification passes are used or reserved'; END IF;
  INSERT INTO public.rectify_passes(user_id, task_id, authorized_by, period)
  SELECT v_task.user_id, v_task.id, v_actor, v_request_period
  WHERE NOT EXISTS (SELECT 1 FROM public.rectify_passes WHERE task_id = v_task.id);
  INSERT INTO public.ledger_entries(user_id, task_id, period, amount_cents, entry_type)
  SELECT v_task.user_id, v_task.id, v_period, -v_task.failure_cost_cents, 'rectified'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.ledger_entries WHERE task_id = v_task.id AND entry_type = 'rectified'
  );
  UPDATE public.tasks SET status = 'RECTIFIED', updated_at = now() WHERE id = v_task.id;
  INSERT INTO public.task_events(task_id, event_type, actor_id, actor_user_client_instance_id, from_status, to_status, metadata)
  VALUES (v_task.id, 'RECTIFICATION_APPROVED', v_actor, p_actor_user_client_instance_id,
          v_task.status, 'RECTIFIED', jsonb_build_object('direct', true));
  RETURN QUERY SELECT v_task.id, v_task.user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_task_rectification_pass_summary(p_task_id uuid)
RETURNS TABLE (period text, used integer, reserved integer, monthly_limit integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_task public.tasks%ROWTYPE;
  v_timezone text;
  v_period text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR (v_actor <> v_task.user_id AND v_actor IS DISTINCT FROM v_task.voucher_id) THEN
    RAISE EXCEPTION 'Task not found';
  END IF;
  SELECT COALESCE(timezone, 'UTC') INTO v_timezone FROM public.profiles WHERE id = v_task.user_id;
  v_period := to_char(now() AT TIME ZONE v_timezone, 'YYYY-MM');
  period := v_period;
  SELECT count(*)::integer INTO used FROM public.rectify_passes
    WHERE user_id = v_task.user_id AND rectify_passes.period = v_period;
  SELECT count(*)::integer INTO reserved FROM public.rectification_requests
    WHERE owner_id = v_task.user_id AND request_period = v_period
      AND private.rectification_open_state(state);
  monthly_limit := 5;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_rectification_ai_appeal(
  p_request_id uuid,
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
  v_request public.rectification_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM public.rectification_requests
  WHERE id = p_request_id AND owner_id = v_actor AND state = 'AWAITING_AI_APPEAL'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI rectification appeal is not available'; END IF;
  IF v_request.ai_appeal_count >= 3 THEN RAISE EXCEPTION 'All 3 AI rectification appeals are used'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.task_completion_proofs
    WHERE task_id = v_request.task_id AND upload_state = 'UPLOADED'
  ) THEN RAISE EXCEPTION 'Proof is required for AI rectification'; END IF;
  UPDATE public.rectification_requests
  SET state = 'PENDING_AI', ai_appeal_count = ai_appeal_count + 1,
      reason = COALESCE(NULLIF(btrim(p_reason), ''), reason), updated_at = now()
  WHERE id = p_request_id RETURNING * INTO v_request;
  INSERT INTO public.task_events(task_id, event_type, actor_id, actor_user_client_instance_id, from_status, to_status, metadata)
  VALUES (v_request.task_id, 'RECTIFICATION_AI_APPEALED', v_actor, p_actor_user_client_instance_id,
          'AWAITING_RECTIFICATION', 'AWAITING_RECTIFICATION',
          jsonb_build_object('request_id', p_request_id, 'appeal_count', v_request.ai_appeal_count));
  RETURN NEXT v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.escalate_rectification_to_original_voucher(
  p_request_id uuid,
  p_actor_user_client_instance_id uuid DEFAULT NULL
)
RETURNS SETOF public.rectification_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_request public.rectification_requests%ROWTYPE;
  v_ai_profile constant uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  SELECT * INTO v_request FROM public.rectification_requests
  WHERE id = p_request_id AND owner_id = v_actor AND state = 'AWAITING_AI_APPEAL'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI rectification appeal is not available'; END IF;
  IF v_request.original_voucher_id IN (v_actor, v_ai_profile) THEN
    RAISE EXCEPTION 'No original human voucher is available';
  END IF;
  UPDATE public.rectification_requests
  SET target_type = 'ORIGINAL_VOUCHER', target_voucher_id = original_voucher_id,
      state = 'PENDING_HUMAN', updated_at = now()
  WHERE id = p_request_id RETURNING * INTO v_request;
  INSERT INTO public.task_events(task_id, event_type, actor_id, actor_user_client_instance_id, from_status, to_status, metadata)
  VALUES (v_request.task_id, 'RECTIFICATION_ESCALATED', v_actor, p_actor_user_client_instance_id,
          'AWAITING_RECTIFICATION', 'AWAITING_RECTIFICATION', jsonb_build_object('request_id', p_request_id));
  RETURN NEXT v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_ai_rectification_decision(
  p_request_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL
)
RETURNS TABLE (task_id uuid, owner_id uuid, resolution text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request public.rectification_requests%ROWTYPE;
  v_ai_profile constant uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  SELECT * INTO v_request FROM public.rectification_requests
  WHERE id = p_request_id AND target_type = 'AI' AND state = 'PENDING_AI'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI rectification request is not pending'; END IF;
  UPDATE public.ai_rectification_usage
  SET state = 'consumed', consumed_at = COALESCE(consumed_at, now()), released_at = NULL, updated_at = now()
  WHERE request_id = p_request_id AND state = 'reserved';
  IF p_decision = 'APPROVE' THEN
    PERFORM private.apply_rectification(p_request_id, v_ai_profile, 'RECTIFICATION_APPROVED', 'APPROVED', p_reason);
    RETURN QUERY SELECT v_request.task_id, v_request.owner_id, 'APPROVED'::text;
  ELSIF p_decision = 'DECLINE' THEN
    UPDATE public.rectification_requests
    SET state = 'AWAITING_AI_APPEAL', ai_attempt_count = ai_attempt_count + 1,
        decision_reason = p_reason, updated_at = now()
    WHERE id = p_request_id;
    INSERT INTO public.task_events(task_id, event_type, actor_id, from_status, to_status, metadata)
    VALUES (v_request.task_id, 'RECTIFICATION_AI_DENIED', v_ai_profile,
            'AWAITING_RECTIFICATION', 'AWAITING_RECTIFICATION',
            jsonb_build_object('request_id', p_request_id, 'reason', p_reason));
    RETURN QUERY SELECT v_request.task_id, v_request.owner_id, 'AWAITING_AI_APPEAL'::text;
  ELSE
    RAISE EXCEPTION 'Invalid AI rectification decision';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_due_rectification_requests(
  p_before timestamptz DEFAULT now(),
  p_owner_id uuid DEFAULT NULL
)
RETURNS TABLE (task_id uuid, owner_id uuid, resolution text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request public.rectification_requests%ROWTYPE;
  -- task_events.actor_id and rectify_passes.authorized_by reference profiles.
  -- The seeded AI profile is the valid system actor used elsewhere in the app.
  v_system_actor constant uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  FOR v_request IN
    SELECT * FROM public.rectification_requests
    WHERE private.rectification_open_state(state)
      AND auto_rectify_at <= p_before
      AND (p_owner_id IS NULL OR owner_id = p_owner_id)
    ORDER BY auto_rectify_at
    FOR UPDATE SKIP LOCKED
  LOOP
    IF v_request.state = 'PENDING_HUMAN'
       OR (
         v_request.state = 'PENDING_AI'
         AND v_request.ai_attempt_count = 0
         AND EXISTS (
           SELECT 1 FROM public.task_completion_proofs
           WHERE task_id = v_request.task_id AND upload_state = 'UPLOADED'
         )
       ) THEN
      PERFORM private.apply_rectification(v_request.id, v_system_actor,
        'RECTIFICATION_AUTO_APPROVED', 'AUTO_APPROVED', 'No decision before rectification deadline');
      task_id := v_request.task_id; owner_id := v_request.owner_id; resolution := 'AUTO_APPROVED';
      RETURN NEXT;
    ELSE
      PERFORM private.decline_rectification(v_request.id, v_system_actor,
        'RECTIFICATION_DECLINED', 'DECLINED',
        CASE
          WHEN v_request.state = 'PENDING_AI' AND v_request.ai_attempt_count = 0
            THEN 'Required AI proof was not uploaded before the deadline'
          ELSE 'AI rectification appeal expired'
        END);
      task_id := v_request.task_id; owner_id := v_request.owner_id; resolution := 'DECLINED';
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

-- Proof upload finalization remains atomic while recognizing rectification as
-- an attachable review state and emitting a request-specific timeline event.
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
  v_proof_id uuid;
  v_event_type text;
  v_request_id uuid;
BEGIN
  SELECT id INTO v_proof_id
  FROM public.task_completion_proofs
  WHERE task_id = p_task_id AND owner_id = p_owner_id
    AND bucket = p_bucket AND object_path = p_object_path AND upload_state = 'PENDING'
  FOR UPDATE;
  IF v_proof_id IS NULL THEN
    RETURN QUERY SELECT false, 'Proof record not found or not pending.';
    RETURN;
  END IF;
  IF p_task_status NOT IN (
    'ACTIVE','POSTPONED','AWAITING_USER','AWAITING_VOUCHER','AWAITING_AI',
    'MARKED_COMPLETE','AWAITING_RECTIFICATION'
  ) THEN
    RETURN QUERY SELECT false, 'Task no longer accepts proof uploads.';
    RETURN;
  END IF;

  UPDATE public.task_completion_proofs
  SET media_kind = p_media_kind, mime_type = p_mime_type, size_bytes = p_size_bytes,
      duration_ms = p_duration_ms, overlay_timestamp_text = p_overlay_timestamp_text,
      upload_state = 'UPLOADED', updated_at = v_now
  WHERE id = v_proof_id AND owner_id = p_owner_id;

  UPDATE public.tasks
  SET has_proof = true, proof_request_open = false, proof_requested_at = NULL,
      proof_requested_by = NULL, updated_at = v_now
  WHERE id = p_task_id AND user_id = p_owner_id AND status = p_task_status;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task changed while proof was uploading';
  END IF;

  IF p_task_status = 'AWAITING_RECTIFICATION' THEN
    SELECT id INTO v_request_id
    FROM public.rectification_requests
    WHERE task_id = p_task_id AND private.rectification_open_state(state)
    ORDER BY created_at DESC LIMIT 1;
    v_event_type := 'RECTIFICATION_PROOF_UPLOADED';
  ELSE
    v_event_type := 'PROOF_UPLOADED';
  END IF;

  INSERT INTO public.task_events(task_id, event_type, actor_id, from_status, to_status, metadata)
  VALUES (
    p_task_id, v_event_type, p_owner_id, p_task_status, p_task_status,
    jsonb_build_object(
      'request_id', v_request_id, 'media_kind', p_media_kind, 'mime_type', p_mime_type,
      'size_bytes', p_size_bytes, 'duration_ms', p_duration_ms
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

-- Include request-scoped AI usage in the existing quota response.
CREATE OR REPLACE FUNCTION public.get_ai_voucher_quota()
RETURNS TABLE (
  account_tier text, used integer, pending integer, monthly_limit integer,
  remaining integer, resets_at timestamptz, can_start_review boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_timezone text; v_month_start timestamptz; v_month_end timestamptz;
  v_period text; v_tier text; v_used integer; v_pending integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT COALESCE(p.timezone, 'UTC'), COALESCE(ue.account_tier, 'free')
  INTO v_timezone, v_tier
  FROM public.profiles p LEFT JOIN public.user_entitlements ue ON ue.user_id = p.id
  WHERE p.id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
  v_month_start := date_trunc('month', now() AT TIME ZONE v_timezone) AT TIME ZONE v_timezone;
  v_month_end := (date_trunc('month', now() AT TIME ZONE v_timezone) + interval '1 month') AT TIME ZONE v_timezone;
  v_period := to_char(now() AT TIME ZONE v_timezone, 'YYYY-MM');
  SELECT (
    (SELECT count(*) FROM public.ai_voucher_usage WHERE user_id = v_user_id AND state = 'consumed'
      AND consumed_at >= v_month_start AND consumed_at < v_month_end)
    + (SELECT count(*) FROM public.ai_rectification_usage WHERE user_id = v_user_id
      AND period = v_period AND state = 'consumed')
  )::integer INTO v_used;
  SELECT (
    (SELECT count(*) FROM public.ai_voucher_usage WHERE user_id = v_user_id AND state = 'reserved')
    + (SELECT count(*) FROM public.ai_rectification_usage WHERE user_id = v_user_id
      AND state = 'reserved')
  )::integer INTO v_pending;
  account_tier := v_tier; used := v_used; pending := v_pending;
  monthly_limit := CASE WHEN v_tier = 'paid' THEN NULL ELSE 5 END;
  remaining := CASE WHEN v_tier = 'paid' THEN NULL ELSE greatest(0, 5 - v_used - v_pending) END;
  resets_at := v_month_end;
  can_start_review := v_tier = 'paid' OR (v_used + v_pending) < 5;
  RETURN NEXT;
END;
$$;

-- Human-facing RPC grants.
REVOKE ALL ON FUNCTION public.request_task_rectification(uuid, text, text, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.update_task_rectification(uuid, text, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.cancel_task_rectification(uuid, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.request_rectification_proof(uuid, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.decide_task_rectification(uuid, text, text, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.authorize_task_rectification(uuid, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.get_task_rectification_pass_summary(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.submit_rectification_ai_appeal(uuid, text, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.escalate_rectification_to_original_voucher(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_task_rectification(uuid, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_task_rectification(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_task_rectification(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_rectification_proof(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_task_rectification(uuid, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_task_rectification(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_task_rectification_pass_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_rectification_ai_appeal(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.escalate_rectification_to_original_voucher(uuid, uuid) TO authenticated;

-- Service-only RPC grants.
REVOKE ALL ON FUNCTION public.record_ai_rectification_decision(uuid, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_due_rectification_requests(timestamptz, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_rectification_decision(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_due_rectification_requests(timestamptz, uuid) TO service_role;
REVOKE ALL ON FUNCTION private.rectification_open_state(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION private.apply_rectification(uuid, uuid, text, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION private.decline_rectification(uuid, uuid, text, text, text) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_ai_voucher_quota() TO authenticated, service_role;
