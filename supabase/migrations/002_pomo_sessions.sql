-- Create pomo_sessions table
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS pomo_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  duration_minutes INT NOT NULL, -- Target duration (e.g., 25, 50, 60)
  elapsed_seconds INT NOT NULL DEFAULT 0, -- Tracked time so far
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'DELETED')),
  started_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  paused_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Enable RLS
ALTER TABLE pomo_sessions ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can manage own pomo sessions" ON pomo_sessions
  USING (auth.uid() = user_id);

-- Constraint: Only one ACTIVE or PAUSED (i.e. 'participating') session per user?
-- The requirement says: "The user cannot have multiple pomo sessions running on the same time."
-- "Only one 'active' Pomo record can exist per User ID at any given timestamp."
-- So if status is ACTIVE or PAUSED (since a paused session is still "active" in the UI sense, just not ticking), 
-- we probably want to restrict that.
-- However, strict SQL constraints for "active OR paused" might be tricky with partial indexes if we want to allow multiple completed/deleted.
-- Let's just index on ACTIVE for now as a hard constraint for running timers, and enforce the "Stop and Switch" logic (paused/active) in the app layer or a trigger if needed.
-- Actually, a partial unique index is best for "at most one active session".

CREATE UNIQUE INDEX idx_single_active_pomo ON pomo_sessions (user_id) 
WHERE (status = 'ACTIVE');

-- Index for querying sessions by task
CREATE INDEX idx_pomo_sessions_task_id ON pomo_sessions(task_id);

-- Trigger to update updated_at
CREATE TRIGGER pomo_sessions_updated_at
  BEFORE UPDATE ON pomo_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
