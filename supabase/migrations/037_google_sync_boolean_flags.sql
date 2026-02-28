-- Replace enum-style Google sync kind columns with boolean flags.
-- Also remove deprecated Google Tasks sync metadata.

-- 1) tasks.google_sync_for_task
ALTER TABLE IF EXISTS public.tasks
  ADD COLUMN IF NOT EXISTS google_sync_for_task BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tasks'
      AND column_name = 'google_sync_kind'
  ) THEN
    UPDATE public.tasks
    SET google_sync_for_task = (google_sync_kind = 'EVENT');
  END IF;
END
$$;

ALTER TABLE IF EXISTS public.tasks
  DROP CONSTRAINT IF EXISTS tasks_google_sync_kind_check;

ALTER TABLE IF EXISTS public.tasks
  DROP COLUMN IF EXISTS google_sync_kind;

-- 2) recurrence_rules.google_sync_for_rule
ALTER TABLE IF EXISTS public.recurrence_rules
  ADD COLUMN IF NOT EXISTS google_sync_for_rule BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'recurrence_rules'
      AND column_name = 'google_sync_kind'
  ) THEN
    UPDATE public.recurrence_rules
    SET google_sync_for_rule = (google_sync_kind = 'EVENT');
  END IF;
END
$$;

ALTER TABLE IF EXISTS public.recurrence_rules
  DROP CONSTRAINT IF EXISTS recurrence_rules_google_sync_kind_check;

ALTER TABLE IF EXISTS public.recurrence_rules
  DROP COLUMN IF EXISTS google_sync_kind;

-- 3) Clean stale Google Tasks rows and payload metadata.
DELETE FROM public.google_calendar_task_links
WHERE calendar_id = '@default';

UPDATE public.google_calendar_sync_outbox
SET payload = payload - 'google_item_kind' - 'google_item_id' - 'google_container_id'
WHERE payload IS NOT NULL;

DELETE FROM public.google_calendar_sync_outbox
WHERE (payload ->> 'calendar_id') = '@default'
   OR (payload ->> 'google_container_id') = '@default';

-- 4) Remove deprecated Google Tasks sync metadata columns.
ALTER TABLE IF EXISTS public.google_calendar_connections
  DROP COLUMN IF EXISTS google_tasks_updated_min;

ALTER TABLE IF EXISTS public.google_calendar_task_links
  DROP CONSTRAINT IF EXISTS google_calendar_task_links_item_kind_check;

ALTER TABLE IF EXISTS public.google_calendar_task_links
  DROP COLUMN IF EXISTS google_item_kind;
