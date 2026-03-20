ALTER TABLE task_completion_proofs
  ADD COLUMN IF NOT EXISTS overlay_timestamp_text TEXT NOT NULL DEFAULT '??:?? ??/??/??';
