ALTER TABLE public.profiles
  ADD COLUMN default_task_deadline_time text NOT NULL DEFAULT '23:00',
  ADD CONSTRAINT profiles_default_task_deadline_time_check
    CHECK (default_task_deadline_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$');
