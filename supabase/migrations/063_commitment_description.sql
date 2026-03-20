ALTER TABLE public.commitments
  ADD COLUMN IF NOT EXISTS description TEXT;

UPDATE public.commitments
SET description = 'No description'
WHERE description IS NULL OR char_length(btrim(description)) < 10;

ALTER TABLE public.commitments
  ALTER COLUMN description SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'commitments_description_length_check'
      AND conrelid = 'public.commitments'::regclass
  ) THEN
    ALTER TABLE public.commitments
      DROP CONSTRAINT commitments_description_length_check;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'commitments_description_range_check'
      AND conrelid = 'public.commitments'::regclass
  ) THEN
    ALTER TABLE public.commitments
      ADD CONSTRAINT commitments_description_range_check
      CHECK (
        char_length(btrim(description)) >= 10
        AND char_length(description) <= 500
      );
  END IF;
END
$$;
