--
-- task_events_created_to_active
-- Renames legacy task_events event_type CREATED -> ACTIVE.
--

-- 1) Drop old check first so CREATED -> ACTIVE backfill is allowed.
ALTER TABLE public.task_events
  DROP CONSTRAINT IF EXISTS task_events_event_type_check;

-- 2) Backfill legacy CREATED events.
UPDATE public.task_events
SET event_type = 'ACTIVE'
WHERE event_type = 'CREATED';

-- 3) Recreate check with V2/Orca event types and ACTIVE marker.
--    Use NOT VALID so unexpected historical rows do not block migration.
--    New inserts/updates are still enforced by this constraint.
ALTER TABLE public.task_events
  ADD CONSTRAINT task_events_event_type_check
  CHECK (
    event_type IN (
      'ACTIVE',
      'MARK_COMPLETE',
      'UNDO_COMPLETE',
      'PROOF_UPLOAD_FAILED_REVERT',
      'PROOF_REMOVED',
      'PROOF_REQUESTED',
      'VOUCHER_ACCEPT',
      'VOUCHER_DENY',
      'VOUCHER_DELETE',
      'RECTIFY',
      'FORCE_MAJEURE',
      'DEADLINE_MISSED',
      'VOUCHER_TIMEOUT',
      'POMO_COMPLETED',
      'DEADLINE_WARNING_1H',
      'DEADLINE_WARNING_5M',
      'GOOGLE_EVENT_CANCELLED',
      'POSTPONE',
      'AI_APPROVE',
      'AI_DENY',
      'ORCA_DENIED_AUTO_HOP',
      'ESCALATE',
      'AI_ESCALATE_TO_HUMAN',
      'ACCEPT_DENIAL'
    )
  ) NOT VALID;
