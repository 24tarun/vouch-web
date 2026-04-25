-- Standardize Google event semantics so task deadline always maps to event end.
-- Also carry bounded-window offsets through recurring task generation.

UPDATE public.google_calendar_connections
SET deadline_source_preference = 'end'
WHERE deadline_source_preference IS DISTINCT FROM 'end';

ALTER TABLE public.google_calendar_connections
  ALTER COLUMN deadline_source_preference SET DEFAULT 'end';

ALTER TABLE public.recurrence_rules
  ADD COLUMN IF NOT EXISTS time_bound_for_rule boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS window_start_offset_minutes integer;

UPDATE public.recurrence_rules
SET window_start_offset_minutes = google_event_duration_minutes
WHERE window_start_offset_minutes IS NULL
  AND google_event_duration_minutes IS NOT NULL;
