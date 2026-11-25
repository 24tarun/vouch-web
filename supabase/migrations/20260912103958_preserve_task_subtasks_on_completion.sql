DROP TRIGGER IF EXISTS tasks_delete_subtasks_on_completion ON public.tasks;

DROP FUNCTION IF EXISTS public.delete_subtasks_on_task_completion();
