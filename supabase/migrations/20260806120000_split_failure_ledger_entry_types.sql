-- Preserve the actual failure outcome in the ledger instead of collapsing all
-- outcomes into the generic `failure` accounting category.

ALTER TABLE public.ledger_entries
  DROP CONSTRAINT ledger_entries_entry_type_check;

ALTER TABLE public.ledger_entries
  ADD CONSTRAINT ledger_entries_entry_type_check
  CHECK (entry_type = ANY (ARRAY[
    'failure', 'denied', 'missed', 'surrendered', 'rectified', 'override', 'voucher_timeout_penalty'
  ]));

-- Backfill legacy rows using the immutable task event history. This still works
-- after a task was rectified, because the original failure event remains.
UPDATE public.ledger_entries AS ledger
SET entry_type = CASE
  WHEN EXISTS (
    SELECT 1 FROM public.task_events event
    WHERE event.task_id = ledger.task_id AND event.event_type = 'SURRENDER'
  ) OR EXISTS (
    SELECT 1 FROM public.tasks task
    WHERE task.id = ledger.task_id AND task.status = 'SURRENDERED'
  ) THEN 'surrendered'
  WHEN EXISTS (
    SELECT 1 FROM public.task_events event
    WHERE event.task_id = ledger.task_id AND event.event_type = 'DEADLINE_MISSED'
  ) OR EXISTS (
    SELECT 1 FROM public.tasks task
    WHERE task.id = ledger.task_id AND task.status = 'MISSED'
  ) THEN 'missed'
  ELSE 'denied'
END
WHERE ledger.entry_type = 'failure';

ALTER TABLE public.ledger_entries
  DROP CONSTRAINT ledger_entries_entry_type_check;

ALTER TABLE public.ledger_entries
  ADD CONSTRAINT ledger_entries_entry_type_check
  CHECK (entry_type = ANY (ARRAY[
    'denied', 'missed', 'surrendered', 'rectified', 'override', 'voucher_timeout_penalty'
  ]));

-- These functions find the original charge before creating a rectification.
-- Recreate them with all three explicit failure outcomes.
DO $$
DECLARE
  function_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.request_task_rectification(uuid,text,text,uuid)'::regprocedure
  ) INTO function_definition;
  function_definition := replace(
    function_definition,
    'entry_type = ''failure''',
    'entry_type IN (''denied'', ''missed'', ''surrendered'')'
  );
  EXECUTE function_definition;

  SELECT pg_get_functiondef(
    'public.authorize_task_rectification(uuid,uuid)'::regprocedure
  ) INTO function_definition;
  function_definition := replace(
    function_definition,
    'entry_type = ''failure''',
    'entry_type IN (''denied'', ''missed'', ''surrendered'')'
  );
  EXECUTE function_definition;

  SELECT pg_get_functiondef(
    'public.surrender_task_atomic(uuid,uuid)'::regprocedure
  ) INTO function_definition;
  function_definition := replace(
    function_definition,
    '''failure''',
    '''surrendered'''
  );
  EXECUTE function_definition;
END;
$$;
