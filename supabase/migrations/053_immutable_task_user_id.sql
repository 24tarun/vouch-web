-- Prevent tasks.user_id from being changed after insert.
-- user_id is the ownership anchor for the entire task graph (subtasks, reminders,
-- proofs, ledger entries). There is no legitimate use case for reassigning it.

CREATE OR REPLACE FUNCTION prevent_task_user_id_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.user_id <> OLD.user_id THEN
        RAISE EXCEPTION 'tasks.user_id is immutable and cannot be changed';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_task_user_id_immutable
    BEFORE UPDATE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION prevent_task_user_id_change();
