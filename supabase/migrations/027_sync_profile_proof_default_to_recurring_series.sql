-- When a user enables "all tasks require proof", apply that default to
-- existing recurring series and any still-actionable recurring task instances.

CREATE OR REPLACE FUNCTION public.sync_profile_proof_default_to_recurring_series()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.default_requires_proof_for_all_tasks = true
     AND (
       TG_OP = 'INSERT'
       OR OLD.default_requires_proof_for_all_tasks IS DISTINCT FROM NEW.default_requires_proof_for_all_tasks
     ) THEN
    UPDATE public.recurrence_rules
    SET requires_proof = true
    WHERE user_id = NEW.id
      AND requires_proof = false;

    UPDATE public.tasks
    SET
      requires_proof = true,
      updated_at = now()
    WHERE user_id = NEW.id
      AND recurrence_rule_id IS NOT NULL
      AND requires_proof = false
      AND status = ANY (ARRAY['ACTIVE', 'POSTPONED', 'AWAITING_USER']);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_profile_proof_default_to_recurring_series ON public.profiles;
CREATE TRIGGER sync_profile_proof_default_to_recurring_series
AFTER INSERT OR UPDATE OF default_requires_proof_for_all_tasks ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_proof_default_to_recurring_series();

-- Backfill users who already have the profile default enabled.
UPDATE public.recurrence_rules rr
SET requires_proof = true
FROM public.profiles p
WHERE rr.user_id = p.id
  AND p.default_requires_proof_for_all_tasks = true
  AND rr.requires_proof = false;

UPDATE public.tasks t
SET
  requires_proof = true,
  updated_at = now()
FROM public.profiles p
WHERE t.user_id = p.id
  AND p.default_requires_proof_for_all_tasks = true
  AND t.recurrence_rule_id IS NOT NULL
  AND t.requires_proof = false
  AND t.status = ANY (ARRAY['ACTIVE', 'POSTPONED', 'AWAITING_USER']);
