CREATE TABLE IF NOT EXISTS public.google_calendar_event_tombstones (
  user_id     UUID  NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  calendar_id TEXT  NOT NULL,
  google_event_id TEXT NOT NULL,
  deleted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT google_calendar_event_tombstones_pkey
    PRIMARY KEY (user_id, calendar_id, google_event_id)
);

ALTER TABLE public.google_calendar_event_tombstones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own tombstones"
  ON public.google_calendar_event_tombstones FOR SELECT USING (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_processing_unique
  ON public.google_calendar_sync_outbox (user_id, task_id)
  WHERE status = 'PROCESSING' AND task_id IS NOT NULL;
