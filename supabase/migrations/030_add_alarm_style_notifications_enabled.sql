ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS alarm_style_notifications_enabled boolean NOT NULL DEFAULT false;
