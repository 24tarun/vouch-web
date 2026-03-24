--
-- task_status_v2 parity migration
-- Keeps repository schema aligned with the applied V2 task lifecycle migration.
--

-- 1) Backfill tasks from legacy statuses (idempotent)
UPDATE public.tasks SET status = 'ACTIVE' WHERE status = 'CREATED';

UPDATE public.tasks
SET status = 'AUTO_ACCEPTED'
WHERE status = 'COMPLETED' AND voucher_timeout_auto_accepted = true;

UPDATE public.tasks
SET status = 'ACCEPTED'
WHERE status = 'COMPLETED';

UPDATE public.tasks
SET status = 'DENIED'
WHERE status = 'FAILED' AND marked_completed_at IS NOT NULL;

UPDATE public.tasks
SET status = 'MISSED'
WHERE status = 'FAILED';

UPDATE public.tasks
SET status = 'MARKED_COMPLETE'
WHERE status = 'MARKED_COMPLETED';

-- 2) Backfill task_events legacy status values (idempotent)
UPDATE public.task_events SET from_status = 'ACTIVE' WHERE from_status = 'CREATED';
UPDATE public.task_events SET to_status = 'ACTIVE' WHERE to_status = 'CREATED';

UPDATE public.task_events SET from_status = 'MARKED_COMPLETE' WHERE from_status = 'MARKED_COMPLETED';
UPDATE public.task_events SET to_status = 'MARKED_COMPLETE' WHERE to_status = 'MARKED_COMPLETED';

UPDATE public.task_events SET from_status = 'ACCEPTED' WHERE from_status = 'COMPLETED';
UPDATE public.task_events SET to_status = 'ACCEPTED' WHERE to_status = 'COMPLETED';

UPDATE public.task_events SET from_status = 'DENIED' WHERE from_status = 'FAILED';
UPDATE public.task_events SET to_status = 'DENIED' WHERE to_status = 'FAILED';

-- 3) Recreate tasks status constraint with the V2 lifecycle set
ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_status_check;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_status_check
  CHECK (
    status IN (
      'ACTIVE',
      'POSTPONED',
      'MARKED_COMPLETE',
      'AWAITING_VOUCHER',
      'AWAITING_ORCA',
      'ORCA_DENIED',
      'AWAITING_USER',
      'ESCALATED',
      'ACCEPTED',
      'AUTO_ACCEPTED',
      'ORCA_ACCEPTED',
      'DENIED',
      'MISSED',
      'RECTIFIED',
      'SETTLED',
      'DELETED'
    )
  );

-- 4) Recreate task_events status constraints with the V2 lifecycle set
ALTER TABLE public.task_events
  DROP CONSTRAINT IF EXISTS task_events_from_status_check;

ALTER TABLE public.task_events
  ADD CONSTRAINT task_events_from_status_check
  CHECK (
    from_status IN (
      'ACTIVE',
      'POSTPONED',
      'MARKED_COMPLETE',
      'AWAITING_VOUCHER',
      'AWAITING_ORCA',
      'ORCA_DENIED',
      'AWAITING_USER',
      'ESCALATED',
      'ACCEPTED',
      'AUTO_ACCEPTED',
      'ORCA_ACCEPTED',
      'DENIED',
      'MISSED',
      'RECTIFIED',
      'SETTLED',
      'DELETED'
    )
  );

ALTER TABLE public.task_events
  DROP CONSTRAINT IF EXISTS task_events_to_status_check;

ALTER TABLE public.task_events
  ADD CONSTRAINT task_events_to_status_check
  CHECK (
    to_status IN (
      'ACTIVE',
      'POSTPONED',
      'MARKED_COMPLETE',
      'AWAITING_VOUCHER',
      'AWAITING_ORCA',
      'ORCA_DENIED',
      'AWAITING_USER',
      'ESCALATED',
      'ACCEPTED',
      'AUTO_ACCEPTED',
      'ORCA_ACCEPTED',
      'DENIED',
      'MISSED',
      'RECTIFIED',
      'SETTLED',
      'DELETED'
    )
  );

-- 5) Recreate partial indexes that referenced legacy statuses
DROP INDEX IF EXISTS public.idx_tasks_active_deadline;
CREATE INDEX idx_tasks_active_deadline
  ON public.tasks USING btree (deadline)
  WHERE status IN ('ACTIVE', 'POSTPONED');

DROP INDEX IF EXISTS public.idx_tasks_owner_open_proof_requests;
CREATE INDEX idx_tasks_owner_open_proof_requests
  ON public.tasks USING btree (user_id)
  WHERE proof_request_open = true
    AND status IN ('AWAITING_VOUCHER', 'AWAITING_ORCA', 'MARKED_COMPLETE');

-- 6) Keep subtask cleanup aligned with V2 completion pipeline
CREATE OR REPLACE FUNCTION public.delete_subtasks_on_task_completion()
RETURNS trigger AS $$
BEGIN
  IF NEW.status IN (
      'MARKED_COMPLETE',
      'AWAITING_VOUCHER',
      'AWAITING_ORCA',
      'ACCEPTED',
      'AUTO_ACCEPTED',
      'ORCA_ACCEPTED'
    )
    AND OLD.status IS DISTINCT FROM NEW.status THEN
    DELETE FROM public.task_subtasks
    WHERE parent_task_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7) Orca timeout artifacts are no longer used
DROP INDEX IF EXISTS public.idx_tasks_awaiting_orca_deadline;
ALTER TABLE public.tasks DROP COLUMN IF EXISTS orca_review_deadline;
