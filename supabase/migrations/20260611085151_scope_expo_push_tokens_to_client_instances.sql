ALTER TABLE public.expo_push_tokens
  ADD COLUMN IF NOT EXISTS user_client_instance_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_client_instances_id_user_id_unique'
      AND conrelid = 'public.user_client_instances'::regclass
  ) THEN
    ALTER TABLE public.user_client_instances
      ADD CONSTRAINT user_client_instances_id_user_id_unique
      UNIQUE (id, user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'expo_push_tokens_user_client_instance_id_user_id_fkey'
      AND conrelid = 'public.expo_push_tokens'::regclass
  ) THEN
    ALTER TABLE public.expo_push_tokens
      ADD CONSTRAINT expo_push_tokens_user_client_instance_id_user_id_fkey
      FOREIGN KEY (user_client_instance_id, user_id)
      REFERENCES public.user_client_instances (id, user_id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'expo_push_tokens_user_client_instance_unique'
      AND conrelid = 'public.expo_push_tokens'::regclass
  ) THEN
    ALTER TABLE public.expo_push_tokens
      ADD CONSTRAINT expo_push_tokens_user_client_instance_unique
      UNIQUE (user_id, user_client_instance_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS expo_push_tokens_user_client_instance_id_idx
  ON public.expo_push_tokens USING btree (user_client_instance_id)
  WHERE user_client_instance_id IS NOT NULL;
