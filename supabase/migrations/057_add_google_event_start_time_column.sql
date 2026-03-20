-- Persist event start-times for Google Calendar event sync.
ALTER TABLE IF EXISTS public.tasks
  ADD COLUMN IF NOT EXISTS google_event_start_at TIMESTAMPTZ;
