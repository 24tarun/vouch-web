-- Drop the overly permissive ledger_entries INSERT policy.
-- All legitimate inserts go through the service role (admin client) which
-- bypasses RLS entirely. A user-facing INSERT policy serves no purpose and
-- allows any authenticated user to insert arbitrary ledger rows for themselves.
DROP POLICY IF EXISTS "System can insert ledger entries" ON public.ledger_entries;
