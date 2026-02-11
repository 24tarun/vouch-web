-- Add per-user toggle for final deadline warning notifications.
-- This controls the default 5-minute warning only.
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS deadline_final_warning_enabled BOOLEAN NOT NULL DEFAULT true;
