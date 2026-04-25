ALTER TABLE public.google_calendar_connections
  ADD COLUMN IF NOT EXISTS default_event_color_id text NOT NULL DEFAULT '9'
    CHECK (default_event_color_id = ANY (ARRAY['1','2','3','4','5','6','7','8','9','10','11']));
