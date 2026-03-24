--
-- task_events_add_proof_uploaded
-- Adds PROOF_UPLOADED to allowed task_events.event_type values and backfills
-- one synthetic upload event per task when an uploaded proof exists but no
-- PROOF_UPLOADED event is present.
--

ALTER TABLE public.task_events
  DROP CONSTRAINT IF EXISTS task_events_event_type_check;

ALTER TABLE public.task_events
  ADD CONSTRAINT task_events_event_type_check
  CHECK (
    event_type IN (
      'ACTIVE',
      'MARK_COMPLETE',
      'UNDO_COMPLETE',
      'PROOF_UPLOADED',
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

INSERT INTO public.task_events (
  task_id,
  event_type,
  actor_id,
  from_status,
  to_status,
  metadata,
  created_at
)
SELECT
  p.task_id,
  'PROOF_UPLOADED',
  p.owner_id,
  t.status,
  t.status,
  jsonb_build_object(
    'backfilled', true,
    'media_kind', p.media_kind,
    'mime_type', p.mime_type,
    'size_bytes', p.size_bytes,
    'duration_ms', p.duration_ms
  ),
  COALESCE(p.updated_at, p.created_at, now())
FROM public.task_completion_proofs p
JOIN public.tasks t
  ON t.id = p.task_id
WHERE p.upload_state = 'UPLOADED'
  AND NOT EXISTS (
    SELECT 1
    FROM public.task_events e
    WHERE e.task_id = p.task_id
      AND e.event_type = 'PROOF_UPLOADED'
  );
