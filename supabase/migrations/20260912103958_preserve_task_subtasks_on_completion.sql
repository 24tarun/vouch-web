-- Subtasks are task-owned history. Keep them through completion and review;
-- the existing parent_task_id foreign key still removes them when the task
-- itself is deleted.
DROP TRIGGER IF EXISTS tasks_delete_subtasks_on_completion ON public.tasks;

DROP FUNCTION IF EXISTS public.delete_subtasks_on_task_completion();
