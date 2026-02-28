-- Ensure Realtime publication includes Google Calendar outbox updates.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'google_calendar_sync_outbox'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.google_calendar_sync_outbox;
  END IF;
END
$$;

-- Include previous row values for update payloads and consistency with other realtime tables.
ALTER TABLE IF EXISTS public.google_calendar_sync_outbox REPLICA IDENTITY FULL;
