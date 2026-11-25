CREATE OR REPLACE FUNCTION public.delete_reminders_on_final_task_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status IN (
    'ACCEPTED', 'AUTO_ACCEPTED', 'AI_ACCEPTED',
    'DENIED', 'MISSED', 'RECTIFIED', 'SETTLED', 'DELETED'
  ) AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    DELETE FROM public.task_reminders
    WHERE parent_task_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_delete_reminders_on_final_task_state
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_reminders_on_final_task_state();
