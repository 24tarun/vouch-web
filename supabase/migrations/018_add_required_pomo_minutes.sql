-- Add optional required pomodoro minutes on tasks and recurrence rules.
-- NULL means no completion focus requirement.

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS required_pomo_minutes INT;

ALTER TABLE tasks
DROP CONSTRAINT IF EXISTS tasks_required_pomo_minutes_check;

ALTER TABLE tasks
ADD CONSTRAINT tasks_required_pomo_minutes_check
CHECK (
  required_pomo_minutes IS NULL
  OR (required_pomo_minutes >= 1 AND required_pomo_minutes <= 10000)
);

ALTER TABLE recurrence_rules
ADD COLUMN IF NOT EXISTS required_pomo_minutes INT;

ALTER TABLE recurrence_rules
DROP CONSTRAINT IF EXISTS recurrence_rules_required_pomo_minutes_check;

ALTER TABLE recurrence_rules
ADD CONSTRAINT recurrence_rules_required_pomo_minutes_check
CHECK (
  required_pomo_minutes IS NULL
  OR (required_pomo_minutes >= 1 AND required_pomo_minutes <= 10000)
);
