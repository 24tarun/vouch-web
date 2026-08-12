-- Mobile operating systems suspend JavaScript while an app is backgrounded or
-- the phone is locked. A missing mobile heartbeat therefore cannot prove that
-- the user dismissed the app. Mobile sessions are completed only from an
-- explicit native close request; web and Mac retain heartbeat-timeout cleanup.
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
    LEFT JOIN public.user_client_instances AS owner
      ON owner.id = ps.owner_user_client_instance_id
      AND owner.user_id = ps.user_id
    WHERE ps.status IN ('ACTIVE', 'PAUSED')
      AND (
        (
          ps.close_requested_at IS NOT NULL
          AND ps.close_requested_at <= clock_timestamp() - interval '5 seconds'
        )
        OR (
          ps.owner_heartbeat_at IS NOT NULL
          AND ps.owner_heartbeat_at <= clock_timestamp() - interval '45 seconds'
          AND COALESCE(owner.platform NOT IN ('ios', 'android'), true)
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
