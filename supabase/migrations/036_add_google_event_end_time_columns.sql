-- Persist event end-times for Google Calendar event sync.
ALTER TABLE IF EXISTS public.tasks
  ADD COLUMN IF NOT EXISTS google_event_end_at TIMESTAMPTZ;

-- Persist recurrence event duration so generated EVENT tasks keep end-times.
ALTER TABLE IF EXISTS public.recurrence_rules
  ADD COLUMN IF NOT EXISTS google_event_duration_minutes INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'recurrence_rules_google_event_duration_minutes_check'
  ) THEN
    ALTER TABLE public.recurrence_rules
      ADD CONSTRAINT recurrence_rules_google_event_duration_minutes_check
      CHECK (
        google_event_duration_minutes IS NULL
        OR google_event_duration_minutes > 0
      );
  END IF;
END
$$;
