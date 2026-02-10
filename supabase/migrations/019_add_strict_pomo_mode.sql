-- Add strict Pomodoro mode toggle and per-session strict stamp.
-- strict_pomo_enabled: user default for newly started sessions.
-- is_strict: immutable session mode captured at start time.

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS strict_pomo_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE pomo_sessions
ADD COLUMN IF NOT EXISTS is_strict BOOLEAN NOT NULL DEFAULT false;
