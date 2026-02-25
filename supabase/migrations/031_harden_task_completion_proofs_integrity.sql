-- Harden task proof metadata so proof media cannot be re-pointed after creation.

ALTER TABLE task_completion_proofs
  DROP CONSTRAINT IF EXISTS task_completion_proofs_bucket_fixed;

ALTER TABLE task_completion_proofs
  ADD CONSTRAINT task_completion_proofs_bucket_fixed
  CHECK (bucket = 'task-proofs');

CREATE OR REPLACE FUNCTION public.prevent_task_proof_location_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.bucket IS DISTINCT FROM OLD.bucket THEN
    RAISE EXCEPTION 'bucket is immutable';
  END IF;
  IF NEW.object_path IS DISTINCT FROM OLD.object_path THEN
    RAISE EXCEPTION 'object_path is immutable';
  END IF;
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'owner_id is immutable';
  END IF;
  IF NEW.voucher_id IS DISTINCT FROM OLD.voucher_id THEN
    RAISE EXCEPTION 'voucher_id is immutable';
  END IF;
  IF NEW.task_id IS DISTINCT FROM OLD.task_id THEN
    RAISE EXCEPTION 'task_id is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_completion_proofs_prevent_location_mutation
  ON task_completion_proofs;

CREATE TRIGGER task_completion_proofs_prevent_location_mutation
  BEFORE UPDATE ON task_completion_proofs
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_task_proof_location_mutation();

