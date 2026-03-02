-- Add optional task start timestamp while keeping deadline as mandatory end-time.
ALTER TABLE IF EXISTS public.tasks
  ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tasks_start_at_before_deadline_check'
      AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_start_at_before_deadline_check
      CHECK (start_at IS NULL OR start_at < deadline);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_tasks_start_at ON public.tasks(start_at);
