
REVOKE EXECUTE ON FUNCTION public.complete_task_at_client_time(uuid, timestamptz, text, timestamptz) FROM anon;

REVOKE EXECUTE ON FUNCTION public.enqueue_reminder_invalidations() FROM anon, authenticated, public;
