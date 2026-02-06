-- Add per-user defaults for task creation and Pomodoro
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS default_pomo_duration_minutes INT NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS default_failure_cost_cents INT NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS default_voucher_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_default_pomo_duration_minutes_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_default_pomo_duration_minutes_check
      CHECK (default_pomo_duration_minutes BETWEEN 1 AND 720);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_default_failure_cost_cents_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_default_failure_cost_cents_check
      CHECK (default_failure_cost_cents BETWEEN 1 AND 10000);
  END IF;
END $$;
