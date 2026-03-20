-- Migration: 048_indexes.sql

CREATE INDEX IF NOT EXISTS idx_tasks_active_deadline
  ON public.tasks(deadline)
  WHERE status IN ('CREATED', 'POSTPONED');

CREATE INDEX IF NOT EXISTS idx_tasks_awaiting_voucher_deadline
  ON public.tasks(voucher_response_deadline)
  WHERE status = 'AWAITING_VOUCHER';

CREATE INDEX IF NOT EXISTS idx_tasks_voucher_status
  ON public.tasks(voucher_id, status);

CREATE INDEX IF NOT EXISTS idx_task_events_task_event_type
  ON public.task_events(task_id, event_type);

CREATE INDEX IF NOT EXISTS idx_rectify_passes_user_period
  ON public.rectify_passes(user_id, period);

CREATE INDEX IF NOT EXISTS idx_force_majeure_user_period
  ON public.force_majeure(user_id, period);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_task_id
  ON public.ledger_entries(task_id);

CREATE INDEX IF NOT EXISTS idx_pomo_sessions_active_by_task
  ON public.pomo_sessions(task_id, elapsed_seconds)
  WHERE status != 'DELETED';