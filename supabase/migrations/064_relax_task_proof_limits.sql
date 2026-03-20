-- Relax task proof limits: remove 5MB size cap, extend video max to 30s

-- Drop old constraints
ALTER TABLE task_completion_proofs
  DROP CONSTRAINT IF EXISTS task_completion_proofs_size_bytes_check,
  DROP CONSTRAINT IF EXISTS task_completion_proofs_duration_ms_check;

-- Re-add constraints without size upper bound and with 30s video cap
ALTER TABLE task_completion_proofs
  ADD CONSTRAINT task_completion_proofs_size_bytes_check CHECK (size_bytes > 0),
  ADD CONSTRAINT task_completion_proofs_duration_ms_check CHECK (duration_ms IS NULL OR (duration_ms > 0 AND duration_ms <= 30000));

-- Remove file size limit from storage bucket
UPDATE storage.buckets
SET file_size_limit = NULL
WHERE id = 'task-proofs';
