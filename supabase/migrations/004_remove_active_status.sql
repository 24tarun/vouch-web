-- Migration: Remove ACTIVE status from tasks
-- This migration removes the ACTIVE status as tasks are now immediately active upon creation (CREATED state)

-- Drop the existing CHECK constraint
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;

-- Add the new CHECK constraint without ACTIVE
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN (
  'CREATED', 'POSTPONED', 'MARKED_COMPLETED',
  'AWAITING_VOUCHER', 'COMPLETED', 'FAILED', 'RECTIFIED', 'SETTLED', 'DELETED'
));

-- Note: If there are any existing tasks with status 'ACTIVE', they should be migrated to 'CREATED'
-- This is a breaking change and should be run after verifying there are no ACTIVE tasks
-- Or uncomment the following line to migrate them:
UPDATE tasks SET status = 'CREATED' WHERE status = 'ACTIVE';
