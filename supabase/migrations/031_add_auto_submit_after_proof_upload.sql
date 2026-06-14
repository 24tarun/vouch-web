ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS auto_submit_after_proof_upload boolean NOT NULL DEFAULT true;
