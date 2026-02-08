-- Persisted dashboard tips visibility preference
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS hide_tips BOOLEAN NOT NULL DEFAULT false;
