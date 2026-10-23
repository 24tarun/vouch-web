ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS show_past_tasks boolean NOT NULL DEFAULT true;
