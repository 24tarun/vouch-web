-- Add reminder source classification and seed default deadline reminders.
-- Model: per-task editable reminders with seeded defaults from profile toggles.

ALTER TABLE task_reminders
  ADD COLUMN IF NOT EXISTS source TEXT;

UPDATE task_reminders
SET source = 'MANUAL'
WHERE source IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'task_reminders_source_check'
  ) THEN
    ALTER TABLE task_reminders
      ADD CONSTRAINT task_reminders_source_check
      CHECK (source IN ('MANUAL', 'DEFAULT_DEADLINE_1H', 'DEFAULT_DEADLINE_5M'));
  END IF;
END $$;

ALTER TABLE task_reminders
  ALTER COLUMN source SET DEFAULT 'MANUAL';

ALTER TABLE task_reminders
  ALTER COLUMN source SET NOT NULL;

-- Backfill existing active tasks with seeded 1-hour default reminders.
-- For reminders that are already in the past, mark as notified immediately and
-- stamp created/updated/notified with the same seeded timestamp.
WITH seeded AS (
  SELECT NOW() AS seeded_now
)
INSERT INTO task_reminders (
  parent_task_id,
  user_id,
  reminder_at,
  source,
  notified_at,
  created_at,
  updated_at
)
SELECT
  t.id,
  t.user_id,
  t.deadline - INTERVAL '1 hour',
  'DEFAULT_DEADLINE_1H',
  CASE
    WHEN (t.deadline - INTERVAL '1 hour') <= seeded.seeded_now THEN seeded.seeded_now
    ELSE NULL
  END,
  seeded.seeded_now,
  seeded.seeded_now
FROM tasks t
JOIN profiles p ON p.id = t.user_id
CROSS JOIN seeded
WHERE t.status IN ('CREATED', 'POSTPONED')
  AND p.deadline_one_hour_warning_enabled = true
ON CONFLICT (parent_task_id, reminder_at) DO NOTHING;

-- Backfill existing active tasks with seeded 5-minute default reminders.
WITH seeded AS (
  SELECT NOW() AS seeded_now
)
INSERT INTO task_reminders (
  parent_task_id,
  user_id,
  reminder_at,
  source,
  notified_at,
  created_at,
  updated_at
)
SELECT
  t.id,
  t.user_id,
  t.deadline - INTERVAL '5 minutes',
  'DEFAULT_DEADLINE_5M',
  CASE
    WHEN (t.deadline - INTERVAL '5 minutes') <= seeded.seeded_now THEN seeded.seeded_now
    ELSE NULL
  END,
  seeded.seeded_now,
  seeded.seeded_now
FROM tasks t
JOIN profiles p ON p.id = t.user_id
CROSS JOIN seeded
WHERE t.status IN ('CREATED', 'POSTPONED')
  AND p.deadline_final_warning_enabled = true
ON CONFLICT (parent_task_id, reminder_at) DO NOTHING;
