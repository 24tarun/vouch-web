ALTER TABLE public.google_calendar_sync_outbox
  ADD COLUMN IF NOT EXISTS payload JSONB NULL;
