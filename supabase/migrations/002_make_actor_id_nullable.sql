-- Make actor_id nullable in task_events to support system events
ALTER TABLE task_events ALTER COLUMN actor_id DROP NOT NULL;
