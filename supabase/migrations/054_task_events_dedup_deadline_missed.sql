-- Prevent duplicate DEADLINE_MISSED events for the same task.
-- The deadline-fail cron and the inline getTask() path can both write this event
-- for the same task, resulting in duplicate rows with no deduplication.
-- A unique partial index enforces at most one DEADLINE_MISSED per task at the DB level.

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_events_one_deadline_missed_per_task
    ON public.task_events (task_id)
    WHERE event_type = 'DEADLINE_MISSED';
