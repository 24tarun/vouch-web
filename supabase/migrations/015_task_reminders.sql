-- Add owner-only task reminders

CREATE TABLE IF NOT EXISTS task_reminders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reminder_at TIMESTAMPTZ NOT NULL,
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (parent_task_id, reminder_at)
);

CREATE INDEX IF NOT EXISTS idx_task_reminders_due
  ON task_reminders(reminder_at)
  WHERE notified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_task_reminders_parent_reminder
  ON task_reminders(parent_task_id, reminder_at);

ALTER TABLE task_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own task reminders" ON task_reminders;
CREATE POLICY "Users can view own task reminders" ON task_reminders
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own task reminders" ON task_reminders;
CREATE POLICY "Users can insert own task reminders" ON task_reminders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own task reminders" ON task_reminders;
CREATE POLICY "Users can update own task reminders" ON task_reminders
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own task reminders" ON task_reminders;
CREATE POLICY "Users can delete own task reminders" ON task_reminders
  FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS task_reminders_updated_at ON task_reminders;
CREATE TRIGGER task_reminders_updated_at
  BEFORE UPDATE ON task_reminders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
