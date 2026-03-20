-- Add voucher_timeout_auto_accepted boolean to tasks table.
-- Eliminates cross-table task_events queries on every stats/history/detail page load.
-- The voucher-timeout job sets this flag when it auto-accepts a task.

ALTER TABLE public.tasks
    ADD COLUMN voucher_timeout_auto_accepted boolean NOT NULL DEFAULT false;

-- Backfill: mark any existing tasks that have a VOUCHER_TIMEOUT event.
UPDATE public.tasks
SET voucher_timeout_auto_accepted = true
WHERE id IN (
    SELECT DISTINCT task_id FROM public.task_events WHERE event_type = 'VOUCHER_TIMEOUT'
);
