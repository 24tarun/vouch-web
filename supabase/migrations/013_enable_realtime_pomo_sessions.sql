-- Enable Realtime for cross-device Pomodoro sync
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
      AND tablename = 'pomo_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pomo_sessions;
  END IF;
END
$$;

-- Include previous row values for UPDATE/DELETE payloads
ALTER TABLE IF EXISTS public.pomo_sessions REPLICA IDENTITY FULL;
