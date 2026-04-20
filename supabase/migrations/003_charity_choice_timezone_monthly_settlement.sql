-- Charity Choice + profile timezone support + monthly settlement idempotency

CREATE TABLE IF NOT EXISTS public.charities (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  key        text        NOT NULL,
  name       text        NOT NULL,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT charities_pkey PRIMARY KEY (id),
  CONSTRAINT charities_key_unique UNIQUE (key)
);

CREATE INDEX IF NOT EXISTS idx_charities_is_active
  ON public.charities (is_active);

DROP TRIGGER IF EXISTS charities_updated_at ON public.charities;
CREATE TRIGGER charities_updated_at
BEFORE UPDATE ON public.charities
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.charities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view active charities" ON public.charities;
CREATE POLICY "Users can view active charities"
  ON public.charities
  FOR SELECT
  USING (true);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS charity_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS selected_charity_id uuid NULL,
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS timezone_user_set boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'profiles'
      AND constraint_name = 'profiles_selected_charity_id_fkey'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_selected_charity_id_fkey
      FOREIGN KEY (selected_charity_id) REFERENCES public.charities (id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_charity_enabled_requires_selected'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_charity_enabled_requires_selected
      CHECK (charity_enabled = false OR selected_charity_id IS NOT NULL);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.normalize_profile_charity_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.selected_charity_id IS NULL THEN
    NEW.charity_enabled := false;
  ELSIF NEW.charity_enabled = false THEN
    NEW.selected_charity_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_profile_charity_state ON public.profiles;
CREATE TRIGGER normalize_profile_charity_state
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.normalize_profile_charity_state();

CREATE TABLE IF NOT EXISTS public.monthly_settlement_runs (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL,
  period      text        NOT NULL,
  timezone    text        NOT NULL,
  total_cents integer,
  charity_key text,
  claimed_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  email_sent  boolean     NOT NULL DEFAULT false,
  CONSTRAINT monthly_settlement_runs_pkey PRIMARY KEY (id),
  CONSTRAINT monthly_settlement_runs_user_period_unique UNIQUE (user_id, period),
  CONSTRAINT monthly_settlement_runs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_monthly_settlement_runs_user_period
  ON public.monthly_settlement_runs (user_id, period);

INSERT INTO public.charities (key, name, is_active)
VALUES
  ('team_trees', 'Team Trees', true),
  ('team_water', 'Team Water', true),
  ('donate_to_developer', 'Donate to Developer', true)
ON CONFLICT (key) DO UPDATE
SET
  name = EXCLUDED.name,
  is_active = EXCLUDED.is_active,
  updated_at = now();
