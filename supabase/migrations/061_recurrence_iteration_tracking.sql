-- Track recurrence iteration counts at both the rule and task level.
-- - recurrence_rules.latest_iteration: total number of tasks generated for the rule
-- - tasks.iteration_number: 1-based sequence number within a recurrence rule

ALTER TABLE recurrence_rules
ADD COLUMN latest_iteration INTEGER NOT NULL DEFAULT 0;

ALTER TABLE tasks
ADD COLUMN iteration_number INTEGER;

ALTER TABLE recurrence_rules
ADD CONSTRAINT recurrence_rules_latest_iteration_non_negative
CHECK (latest_iteration >= 0);

-- Backfill task iteration_number for existing recurring tasks.
WITH ordered_tasks AS (
  SELECT
    id,
    recurrence_rule_id,
    ROW_NUMBER() OVER (
      PARTITION BY recurrence_rule_id
      ORDER BY created_at ASC, id ASC
    )::INTEGER AS iteration_number
  FROM tasks
  WHERE recurrence_rule_id IS NOT NULL
)
UPDATE tasks t
SET iteration_number = ordered_tasks.iteration_number
FROM ordered_tasks
WHERE t.id = ordered_tasks.id;

-- Backfill latest_iteration from the max task iteration per rule.
WITH max_iterations AS (
  SELECT
    recurrence_rule_id,
    MAX(iteration_number)::INTEGER AS max_iteration
  FROM tasks
  WHERE recurrence_rule_id IS NOT NULL
    AND iteration_number IS NOT NULL
  GROUP BY recurrence_rule_id
)
UPDATE recurrence_rules rr
SET latest_iteration = max_iterations.max_iteration
FROM max_iterations
WHERE rr.id = max_iterations.recurrence_rule_id;

-- Enforce iteration_number on recurring tasks (but allow NULL for non-recurring tasks).
ALTER TABLE tasks
ADD CONSTRAINT tasks_iteration_number_required_for_recurring
CHECK (
  recurrence_rule_id IS NULL
  OR (iteration_number IS NOT NULL AND iteration_number > 0)
);

-- Prevent duplicate iteration numbers for the same recurrence rule.
CREATE UNIQUE INDEX idx_tasks_recurrence_rule_iteration
ON tasks (recurrence_rule_id, iteration_number)
WHERE recurrence_rule_id IS NOT NULL
  AND iteration_number IS NOT NULL;

-- Auto-assign next iteration number whenever a recurring task is inserted.
CREATE OR REPLACE FUNCTION assign_recurrence_task_iteration_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.recurrence_rule_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE recurrence_rules
  SET
    latest_iteration = COALESCE(latest_iteration, 0) + 1,
    updated_at = NOW()
  WHERE id = NEW.recurrence_rule_id
  RETURNING latest_iteration INTO NEW.iteration_number;

  IF NEW.iteration_number IS NULL THEN
    RAISE EXCEPTION
      'Cannot assign iteration number: recurrence rule % not found',
      NEW.recurrence_rule_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_recurrence_task_iteration_number ON tasks;

CREATE TRIGGER trg_assign_recurrence_task_iteration_number
BEFORE INSERT ON tasks
FOR EACH ROW
WHEN (NEW.recurrence_rule_id IS NOT NULL)
EXECUTE FUNCTION assign_recurrence_task_iteration_number();
