ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS always_show_active_tasks boolean NOT NULL DEFAULT false;
