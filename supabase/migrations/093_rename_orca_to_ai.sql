-- 093: Rename Orca semantics to AI across statuses, events, and profile preference field

BEGIN;

-- profiles preference column (existing DB compatibility)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'orca_friend_opt_in'
  ) THEN
    ALTER TABLE public.profiles
      RENAME COLUMN orca_friend_opt_in TO ai_friend_opt_in;
  END IF;
END $$;

-- Data backfill for task statuses
UPDATE public.tasks
SET status = CASE status
  WHEN 'AWAITING_ORCA' THEN 'AWAITING_AI'
  WHEN 'ORCA_DENIED' THEN 'AI_DENIED'
  WHEN 'ORCA_ACCEPTED' THEN 'AI_ACCEPTED'
  ELSE status
END
WHERE status IN ('AWAITING_ORCA', 'ORCA_DENIED', 'ORCA_ACCEPTED');

UPDATE public.task_events
SET from_status = CASE from_status
  WHEN 'AWAITING_ORCA' THEN 'AWAITING_AI'
  WHEN 'ORCA_DENIED' THEN 'AI_DENIED'
  WHEN 'ORCA_ACCEPTED' THEN 'AI_ACCEPTED'
  ELSE from_status
END
WHERE from_status IN ('AWAITING_ORCA', 'ORCA_DENIED', 'ORCA_ACCEPTED');

UPDATE public.task_events
SET to_status = CASE to_status
  WHEN 'AWAITING_ORCA' THEN 'AWAITING_AI'
  WHEN 'ORCA_DENIED' THEN 'AI_DENIED'
  WHEN 'ORCA_ACCEPTED' THEN 'AI_ACCEPTED'
  ELSE to_status
END
WHERE to_status IN ('AWAITING_ORCA', 'ORCA_DENIED', 'ORCA_ACCEPTED');

UPDATE public.task_events
SET event_type = 'AI_DENIED_AUTO_HOP'
WHERE event_type = 'ORCA_DENIED_AUTO_HOP';

-- Rebuild tasks status constraint
ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_status_check;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_status_check
  CHECK (status = ANY (ARRAY[
    'ACTIVE','POSTPONED','MARKED_COMPLETE','AWAITING_VOUCHER',
    'AWAITING_AI','AI_DENIED','AWAITING_USER','ESCALATED',
    'ACCEPTED','AUTO_ACCEPTED','AI_ACCEPTED',
    'DENIED','MISSED','RECTIFIED','SETTLED','DELETED'
  ]));

-- Rebuild task_events constraints
ALTER TABLE public.task_events
  DROP CONSTRAINT IF EXISTS task_events_event_type_check;

ALTER TABLE public.task_events
  ADD CONSTRAINT task_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'ACTIVE','MARK_COMPLETE','UNDO_COMPLETE',
    'PROOF_UPLOADED','PROOF_UPLOAD_FAILED_REVERT','PROOF_REMOVED','PROOF_REQUESTED',
    'VOUCHER_ACCEPT','VOUCHER_DENY','VOUCHER_DELETE',
    'RECTIFY','OVERRIDE','DEADLINE_MISSED','VOUCHER_TIMEOUT',
    'POMO_COMPLETED','DEADLINE_WARNING_1H','DEADLINE_WARNING_10M',
    'GOOGLE_EVENT_CANCELLED','POSTPONE','REPETITION_STOPPED',
    'AI_APPROVE','AI_DENY','AI_DENIED_AUTO_HOP',
    'ESCALATE','AI_ESCALATE_TO_HUMAN','ACCEPT_DENIAL'
  ])) NOT VALID;

ALTER TABLE public.task_events
  DROP CONSTRAINT IF EXISTS task_events_from_status_check;

ALTER TABLE public.task_events
  ADD CONSTRAINT task_events_from_status_check
  CHECK (from_status = ANY (ARRAY[
    'ACTIVE','POSTPONED','MARKED_COMPLETE','AWAITING_VOUCHER',
    'AWAITING_AI','AI_DENIED','AWAITING_USER','ESCALATED',
    'ACCEPTED','AUTO_ACCEPTED','AI_ACCEPTED',
    'DENIED','MISSED','RECTIFIED','SETTLED','DELETED'
  ]));

ALTER TABLE public.task_events
  DROP CONSTRAINT IF EXISTS task_events_to_status_check;

ALTER TABLE public.task_events
  ADD CONSTRAINT task_events_to_status_check
  CHECK (to_status = ANY (ARRAY[
    'ACTIVE','POSTPONED','MARKED_COMPLETE','AWAITING_VOUCHER',
    'AWAITING_AI','AI_DENIED','AWAITING_USER','ESCALATED',
    'ACCEPTED','AUTO_ACCEPTED','AI_ACCEPTED',
    'DENIED','MISSED','RECTIFIED','SETTLED','DELETED'
  ]));

-- Partial index carrying old literal
DROP INDEX IF EXISTS public.idx_tasks_owner_open_proof_requests;
CREATE INDEX idx_tasks_owner_open_proof_requests
  ON public.tasks USING btree (user_id)
  WHERE proof_request_open = true
    AND status = ANY (ARRAY['AWAITING_VOUCHER','AWAITING_AI','MARKED_COMPLETE']);

-- Functions with ORCA literals in body
CREATE OR REPLACE FUNCTION public.delete_subtasks_on_task_completion()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN (
      'MARKED_COMPLETE',
      'AWAITING_VOUCHER',
      'AWAITING_AI',
      'ACCEPTED',
      'AUTO_ACCEPTED',
      'AI_ACCEPTED'
    )
    AND OLD.status IS DISTINCT FROM NEW.status THEN
    DELETE FROM public.task_subtasks
    WHERE parent_task_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.has_pending_voucher_conflict(
  p_user_a UUID,
  p_user_b UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.status = ANY (
      ARRAY[
        'ACTIVE',
        'POSTPONED',
        'MARKED_COMPLETE',
        'AWAITING_VOUCHER',
        'AWAITING_AI',
        'AWAITING_USER',
        'ESCALATED'
      ]::text[]
    )
      AND (
        (t.user_id = p_user_a AND t.voucher_id = p_user_b)
        OR
        (t.user_id = p_user_b AND t.voucher_id = p_user_a)
      )
  );
$$;

COMMIT;
