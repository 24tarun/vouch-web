ALTER TABLE public.task_events
  DROP CONSTRAINT IF EXISTS task_events_task_id_fkey;

ALTER TABLE public.task_events
  ADD CONSTRAINT task_events_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES public.tasks (id) ON DELETE CASCADE;
