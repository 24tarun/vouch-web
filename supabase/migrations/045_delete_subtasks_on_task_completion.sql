-- Delete historical subtasks for tasks that are no longer active.
DELETE FROM public.task_subtasks AS ts
USING public.tasks AS t
WHERE t.id = ts.parent_task_id
  AND t.status IN (
    'MARKED_COMPLETED',
    'AWAITING_VOUCHER',
    'COMPLETED',
    'FAILED',
    'RECTIFIED',
    'SETTLED',
    'DELETED'
  );

-- Enforce future cleanup: when a task is marked complete, clear its subtasks.
CREATE OR REPLACE FUNCTION public.delete_subtasks_on_task_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('MARKED_COMPLETED', 'AWAITING_VOUCHER', 'COMPLETED')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    DELETE FROM public.task_subtasks
    WHERE parent_task_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_delete_subtasks_on_completion ON public.tasks;

CREATE TRIGGER tasks_delete_subtasks_on_completion
AFTER UPDATE OF status ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.delete_subtasks_on_task_completion();
