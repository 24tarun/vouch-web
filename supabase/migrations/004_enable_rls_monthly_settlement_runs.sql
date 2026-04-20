-- Enable RLS on monthly settlement idempotency table.
-- Service role used by Trigger.dev bypasses RLS, so no write policy is required for system jobs.

ALTER TABLE public.monthly_settlement_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own monthly settlement runs" ON public.monthly_settlement_runs;
CREATE POLICY "Users can view own monthly settlement runs"
  ON public.monthly_settlement_runs
  FOR SELECT
  USING (auth.uid() = user_id);
