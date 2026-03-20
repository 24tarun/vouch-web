-- Update CHECK constraint to include AWAITING_USER
ALTER TABLE public.tasks DROP CONSTRAINT tasks_status_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check CHECK (status IN (
  'CREATED', 'ACTIVE', 'POSTPONED', 'MARKED_COMPLETED',
  'AWAITING_VOUCHER', 'AWAITING_USER', 'COMPLETED', 'FAILED',
  'RECTIFIED', 'DELETED', 'SETTLED'
));

-- Resubmit tracking on tasks
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS resubmit_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_vouch_calls_count INT NOT NULL DEFAULT 0;

-- Denial history table
CREATE TABLE IF NOT EXISTS public.ai_vouch_denials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  attempt_number INT NOT NULL,
  reason TEXT NOT NULL,
  denied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_vouch_denials_task_id_idx ON public.ai_vouch_denials(task_id);

ALTER TABLE public.ai_vouch_denials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can read own ai_vouch_denials"
  ON public.ai_vouch_denials FOR SELECT
  USING (task_id IN (SELECT id FROM public.tasks WHERE user_id = auth.uid()));
