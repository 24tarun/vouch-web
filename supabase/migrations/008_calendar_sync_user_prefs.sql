ALTER TABLE public.google_calendar_connections
  ADD COLUMN IF NOT EXISTS deadline_source_preference TEXT NOT NULL DEFAULT 'start'
    CHECK (deadline_source_preference IN ('start', 'end')),
  ADD COLUMN IF NOT EXISTS default_event_duration_minutes INT NOT NULL DEFAULT 60
    CHECK (default_event_duration_minutes BETWEEN 5 AND 1440);
