-- Tighten EXECUTE on the functions added by the two preceding migrations.
--
-- `REVOKE ALL ... FROM public` in 20260807190100 does not cover `anon`:
-- Supabase grants EXECUTE to it explicitly via default privileges on the public
-- schema, so the earlier REVOKE did not actually restrict anything.

-- Completion is an authenticated-only operation. Not exploitable anonymously
-- either way (auth.uid() is NULL, so the task lookup matches nothing), but the
-- grant should say what it means.
REVOKE EXECUTE ON FUNCTION public.complete_task_at_client_time(uuid, timestamptz, text, timestamptz) FROM anon;

-- A SECURITY DEFINER trigger function should not be reachable over PostgREST.
-- Calling it outside a trigger context raises "trigger functions can only be
-- called as triggers", so this is hygiene rather than a live hole, but there is
-- no reason for /rest/v1/rpc/enqueue_reminder_invalidations to exist at all.
REVOKE EXECUTE ON FUNCTION public.enqueue_reminder_invalidations() FROM anon, authenticated, public;
