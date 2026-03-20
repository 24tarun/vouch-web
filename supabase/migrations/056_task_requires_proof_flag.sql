-- Add parser-backed proof requirement flags for tasks and recurrence templates.
-- `requires_proof=true` means completion to voucher must include proof media.

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS requires_proof BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE recurrence_rules
ADD COLUMN IF NOT EXISTS requires_proof BOOLEAN NOT NULL DEFAULT false;
