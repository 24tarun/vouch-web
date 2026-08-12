ALTER TABLE public.pomo_sessions
  ADD COLUMN owner_heartbeat_at timestamp with time zone,
  ADD COLUMN close_requested_at timestamp with time zone;

COMMENT ON COLUMN public.pomo_sessions.owner_heartbeat_at IS
  'Latest liveness signal from the owning client. NULL keeps legacy clients outside stale cleanup.';

COMMENT ON COLUMN public.pomo_sessions.close_requested_at IS
  'Set by the owning client while exiting. A heartbeat clears it if the client returns.';

CREATE INDEX pomo_sessions_close_requested_at_idx
  ON public.pomo_sessions USING btree (close_requested_at)
  WHERE close_requested_at IS NOT NULL
    AND status IN ('ACTIVE', 'PAUSED');

CREATE INDEX pomo_sessions_owner_heartbeat_at_idx
  ON public.pomo_sessions USING btree (owner_heartbeat_at)
  WHERE owner_heartbeat_at IS NOT NULL
    AND status IN ('ACTIVE', 'PAUSED');

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION private.complete_stale_pomo_sessions()
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  stale record;
  final_elapsed integer;
  task_status text;
  completed_count integer := 0;
BEGIN
  FOR stale IN
    SELECT
      ps.id,
      ps.user_id,
      ps.task_id,
      ps.owner_user_client_instance_id,
      ps.duration_minutes,
      ps.elapsed_seconds,
      ps.status,
      ps.started_at,
      CASE
        WHEN ps.close_requested_at IS NOT NULL
          AND ps.close_requested_at <= clock_timestamp() - interval '5 seconds'
          THEN ps.close_requested_at
        ELSE ps.owner_heartbeat_at
      END AS effective_end_at,
      CASE
        WHEN ps.close_requested_at IS NOT NULL
          AND ps.close_requested_at <= clock_timestamp() - interval '5 seconds'
          THEN 'owner_close'
        ELSE 'owner_heartbeat_timeout'
      END AS completion_source
    FROM public.pomo_sessions AS ps
    WHERE ps.status IN ('ACTIVE', 'PAUSED')
      AND (
        (
          ps.close_requested_at IS NOT NULL
          AND ps.close_requested_at <= clock_timestamp() - interval '5 seconds'
        )
        OR (
          ps.owner_heartbeat_at IS NOT NULL
          AND ps.owner_heartbeat_at <= clock_timestamp() - interval '45 seconds'
        )
      )
    FOR UPDATE OF ps SKIP LOCKED
  LOOP
    final_elapsed := LEAST(
      stale.duration_minutes * 60,
      stale.elapsed_seconds + CASE
        WHEN stale.status = 'ACTIVE' THEN GREATEST(
          0,
          FLOOR(EXTRACT(EPOCH FROM (stale.effective_end_at - stale.started_at)))::integer
        )
        ELSE 0
      END
    );

    UPDATE public.pomo_sessions
    SET
      status = 'COMPLETED',
      elapsed_seconds = final_elapsed,
      completed_at = stale.effective_end_at,
      close_requested_at = NULL
    WHERE id = stale.id
      AND status IN ('ACTIVE', 'PAUSED');

    IF FOUND THEN
      SELECT status
      INTO task_status
      FROM public.tasks
      WHERE id = stale.task_id
        AND user_id = stale.user_id;

      IF FOUND THEN
        INSERT INTO public.task_events (
          task_id,
          event_type,
          actor_id,
          actor_user_client_instance_id,
          from_status,
          to_status,
          metadata
        )
        VALUES (
          stale.task_id,
          'POMO_COMPLETED',
          stale.user_id,
          stale.owner_user_client_instance_id,
          task_status,
          task_status,
          jsonb_build_object(
            'session_id', stale.id,
            'duration_minutes', stale.duration_minutes,
            'elapsed_seconds', final_elapsed,
            'source', stale.completion_source
          )
        );
      END IF;

      completed_count := completed_count + 1;
    END IF;
  END LOOP;

  RETURN completed_count;
END;
$$;

REVOKE ALL ON FUNCTION private.complete_stale_pomo_sessions() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.complete_stale_pomo_sessions() FROM anon;
REVOKE ALL ON FUNCTION private.complete_stale_pomo_sessions() FROM authenticated;

DO $$
DECLARE
  existing_job_id bigint;
BEGIN
  SELECT jobid
  INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'complete-stale-pomodoro-sessions';

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;
END;
$$;

SELECT cron.schedule(
  'complete-stale-pomodoro-sessions',
  '10 seconds',
  'SELECT private.complete_stale_pomo_sessions();'
);
