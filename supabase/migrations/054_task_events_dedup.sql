-- Prevent duplicate DEADLINE_MISSED events for the same task.
-- The deadline-fail cron and the inline getTask() path can both write this event
-- for the same task. A unique partial index enforces at most one per task.

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_events_one_deadline_missed_per_task
    ON public.task_events (task_id)
    WHERE event_type = 'DEADLINE_MISSED';

-- Prevent duplicate POMO_COMPLETED events for the same session.
-- Three separate paths (endPomoSession, auto-end route, sign-out) can race and
-- each try to write this event. A unique partial index on session_id in metadata
-- ensures only the first one wins; subsequent inserts get a 23505 and are ignored.

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_events_one_pomo_per_session
    ON public.task_events ((metadata->>'session_id'))
    WHERE event_type = 'POMO_COMPLETED';
