-- Surrender already writes its ledger entry inside surrender_task_atomic.
-- The failure-ledger trigger owns only direct DENIED and MISSED transitions.
CREATE OR REPLACE FUNCTION private.record_task_failure_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_timezone text;
BEGIN
  IF NEW.status NOT IN ('DENIED', 'MISSED')
     OR OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(p.timezone, 'UTC')
    INTO v_timezone
  FROM public.profiles AS p
  WHERE p.id = NEW.user_id;

  INSERT INTO public.ledger_entries(user_id, task_id, period, amount_cents, entry_type)
  VALUES (
    NEW.user_id,
    NEW.id,
    to_char(NEW.updated_at AT TIME ZONE COALESCE(v_timezone, 'UTC'), 'YYYY-MM'),
    NEW.failure_cost_cents,
    lower(NEW.status)
  )
  ON CONFLICT (task_id) WHERE entry_type IN ('denied', 'missed', 'surrendered')
  DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.record_task_failure_ledger() FROM public, anon, authenticated;
