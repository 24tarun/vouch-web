-- Track how many commitments a user has abandoned.
-- Note: historical backfill is not possible because abandoned commitments are deleted.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS abandoned_commitments_count INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_abandoned_commitments_count_non_negative'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_abandoned_commitments_count_non_negative
      CHECK (abandoned_commitments_count >= 0);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.increment_abandoned_commitments_count()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Count only active commitment deletions as abandonment.
  IF OLD.status = 'ACTIVE' THEN
    UPDATE public.profiles
    SET abandoned_commitments_count = COALESCE(abandoned_commitments_count, 0) + 1
    WHERE id = OLD.user_id;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS commitments_increment_abandoned_count ON public.commitments;
CREATE TRIGGER commitments_increment_abandoned_count
AFTER DELETE ON public.commitments
FOR EACH ROW
EXECUTE FUNCTION public.increment_abandoned_commitments_count();
