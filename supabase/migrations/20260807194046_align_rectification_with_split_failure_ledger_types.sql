-- A rectification needs the original charge in the ledger so it can reverse
-- it. Keep that invariant in the database rather than relying on every
-- deadline worker or client to make a second, separate write.

CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_one_failure_per_task
  ON public.ledger_entries(task_id)
  WHERE entry_type IN ('denied', 'missed', 'surrendered');

CREATE OR REPLACE FUNCTION private.record_task_failure_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_timezone text;
BEGIN
  IF NEW.status NOT IN ('DENIED', 'MISSED', 'SURRENDERED')
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

DROP TRIGGER IF EXISTS tasks_record_failure_ledger ON public.tasks;
CREATE TRIGGER tasks_record_failure_ledger
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION private.record_task_failure_ledger();

-- Repair the only failures from the current ledger month which reached a
-- final failure status before their ledger entry was recorded.
INSERT INTO public.ledger_entries(user_id, task_id, period, amount_cents, entry_type)
SELECT
  t.user_id,
  t.id,
  to_char(t.updated_at AT TIME ZONE COALESCE(p.timezone, 'UTC'), 'YYYY-MM'),
  t.failure_cost_cents,
  lower(t.status)
FROM public.tasks AS t
LEFT JOIN public.profiles AS p ON p.id = t.user_id
WHERE t.status IN ('DENIED', 'MISSED', 'SURRENDERED')
  AND to_char(t.updated_at AT TIME ZONE COALESCE(p.timezone, 'UTC'), 'YYYY-MM')
      = to_char(now() AT TIME ZONE COALESCE(p.timezone, 'UTC'), 'YYYY-MM')
  AND NOT EXISTS (
    SELECT 1
    FROM public.ledger_entries AS le
    WHERE le.task_id = t.id
      AND le.entry_type IN ('denied', 'missed', 'surrendered')
  )
ON CONFLICT (task_id) WHERE entry_type IN ('denied', 'missed', 'surrendered')
DO NOTHING;
