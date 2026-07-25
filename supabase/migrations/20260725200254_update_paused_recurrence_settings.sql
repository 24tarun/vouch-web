CREATE OR REPLACE FUNCTION public.update_paused_recurrence_settings(
  p_task_id uuid,
  p_time_of_day text DEFAULT NULL,
  p_failure_cost_cents integer DEFAULT NULL,
  p_voucher_id uuid DEFAULT NULL,
  p_requires_proof boolean DEFAULT NULL
)
RETURNS TABLE (
  recurrence_rule_id uuid,
  time_of_day text,
  failure_cost_cents integer,
  voucher_id uuid,
  requires_proof boolean,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_rule_id uuid;
  v_rule_config jsonb;
  v_paused_at timestamptz;
  v_current_failure_cost_cents integer;
  v_current_voucher_id uuid;
  v_current_requires_proof boolean;
  v_currency text;
  v_next_failure_cost_cents integer;
  v_next_voucher_id uuid;
  v_next_requires_proof boolean;
  v_updated_at timestamptz := now();
  v_min_failure_cost_cents integer;
  v_max_failure_cost_cents integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT
    rr.id,
    rr.rule_config,
    rr.paused_at,
    rr.failure_cost_cents,
    rr.voucher_id,
    rr.requires_proof,
    COALESCE(p.currency, 'EUR')
  INTO
    v_rule_id,
    v_rule_config,
    v_paused_at,
    v_current_failure_cost_cents,
    v_current_voucher_id,
    v_current_requires_proof,
    v_currency
  FROM public.tasks t
  JOIN public.recurrence_rules rr ON rr.id = t.recurrence_rule_id
  JOIN public.profiles p ON p.id = rr.user_id
  WHERE t.id = p_task_id
    AND t.user_id = v_user_id
    AND rr.user_id = v_user_id
  FOR UPDATE OF rr;

  IF v_rule_id IS NULL THEN
    RAISE EXCEPTION 'Recurring task not found';
  END IF;

  IF v_paused_at IS NULL THEN
    RAISE EXCEPTION 'Pause repetitions before editing future settings';
  END IF;

  IF p_time_of_day IS NOT NULL
    AND p_time_of_day !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
  THEN
    RAISE EXCEPTION 'Deadline time must use HH:MM in 24-hour time';
  END IF;

  v_next_failure_cost_cents := COALESCE(
    p_failure_cost_cents,
    v_current_failure_cost_cents
  );
  IF v_currency = 'INR' THEN
    v_min_failure_cost_cents := 5000;
    v_max_failure_cost_cents := 100000;
  ELSE
    v_min_failure_cost_cents := 100;
    v_max_failure_cost_cents := 10000;
  END IF;

  IF p_failure_cost_cents IS NOT NULL
    AND (
      v_next_failure_cost_cents < v_min_failure_cost_cents
      OR v_next_failure_cost_cents > v_max_failure_cost_cents
    )
  THEN
    RAISE EXCEPTION 'Failure cost is outside the allowed range';
  END IF;

  v_next_voucher_id := COALESCE(p_voucher_id, v_current_voucher_id);
  IF v_next_voucher_id IS NULL THEN
    RAISE EXCEPTION 'A voucher is required';
  END IF;

  IF p_voucher_id IS NOT NULL
    AND p_voucher_id <> v_user_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.friendships f
      WHERE f.user_id = v_user_id
        AND f.friend_id = p_voucher_id
    )
  THEN
    RAISE EXCEPTION 'You can only assign yourself or a friend as voucher';
  END IF;

  v_next_requires_proof := COALESCE(
    p_requires_proof,
    v_current_requires_proof
  );
  IF v_next_voucher_id = '11111111-1111-1111-1111-111111111111'::uuid THEN
    v_next_requires_proof := true;
  END IF;

  UPDATE public.recurrence_rules
  SET
    rule_config = CASE
      WHEN p_time_of_day IS NULL THEN rule_config
      ELSE jsonb_set(rule_config, '{time_of_day}', to_jsonb(p_time_of_day), true)
    END,
    failure_cost_cents = v_next_failure_cost_cents,
    voucher_id = v_next_voucher_id,
    requires_proof = v_next_requires_proof,
    updated_at = v_updated_at
  WHERE id = v_rule_id
    AND user_id = v_user_id
    AND paused_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Repetitions are no longer paused';
  END IF;

  RETURN QUERY
  SELECT
    rr.id,
    rr.rule_config->>'time_of_day',
    rr.failure_cost_cents,
    rr.voucher_id,
    rr.requires_proof,
    rr.updated_at
  FROM public.recurrence_rules rr
  WHERE rr.id = v_rule_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_paused_recurrence_settings(
  uuid,
  text,
  integer,
  uuid,
  boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_paused_recurrence_settings(
  uuid,
  text,
  integer,
  uuid,
  boolean
) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_paused_recurrence_settings(
  uuid,
  text,
  integer,
  uuid,
  boolean
) TO authenticated;
