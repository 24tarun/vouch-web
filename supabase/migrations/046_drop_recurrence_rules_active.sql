-- The recurrence_rules table now stores only active rules.
-- Stopped rules are deleted via application flow (cancelRepetition).
-- Remove the legacy active flag and its index.

DROP INDEX IF EXISTS public.idx_recurrence_rules_active;

ALTER TABLE public.recurrence_rules
  DROP COLUMN IF EXISTS active;
