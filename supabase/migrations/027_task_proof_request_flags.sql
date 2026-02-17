-- Track outstanding voucher proof requests on tasks.
ALTER TABLE IF EXISTS public.tasks
  ADD COLUMN IF NOT EXISTS proof_request_open BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS proof_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS proof_requested_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Fast count for owner-facing proof request badges.
CREATE INDEX IF NOT EXISTS idx_tasks_owner_open_proof_requests
  ON public.tasks (user_id)
  WHERE proof_request_open = true
    AND status IN ('AWAITING_VOUCHER', 'MARKED_COMPLETED');
