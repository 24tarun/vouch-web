--
-- 089: Client-instance attribution for cross-platform audit trails
-- Adds:
--   1) user_client_instances table (one row per app/browser instance)
--   2) tasks.created_by_user_client_instance_id
--   3) task_events.actor_user_client_instance_id
--

-- ============================================
-- USER CLIENT INSTANCES
-- ============================================
CREATE TABLE public.user_client_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  client_name TEXT NOT NULL,
  device_label TEXT,
  app_version TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT user_client_instances_platform_check
    CHECK (platform = ANY (ARRAY['web','ios','android']))
);

CREATE INDEX user_client_instances_user_id_idx
  ON public.user_client_instances (user_id);

CREATE INDEX user_client_instances_last_seen_at_idx
  ON public.user_client_instances (last_seen_at DESC);

-- Keep updated_at fresh on every update
CREATE TRIGGER user_client_instances_updated_at
  BEFORE UPDATE ON public.user_client_instances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- TASK ATTRIBUTION
-- ============================================
ALTER TABLE public.tasks
  ADD COLUMN created_by_user_client_instance_id UUID
    REFERENCES public.user_client_instances(id) ON DELETE SET NULL;

CREATE INDEX tasks_created_by_user_client_instance_id_idx
  ON public.tasks (created_by_user_client_instance_id);

-- ============================================
-- TASK EVENT ATTRIBUTION
-- ============================================
ALTER TABLE public.task_events
  ADD COLUMN actor_user_client_instance_id UUID
    REFERENCES public.user_client_instances(id) ON DELETE SET NULL;

CREATE INDEX task_events_actor_user_client_instance_id_idx
  ON public.task_events (actor_user_client_instance_id);

-- ============================================
-- RLS + POLICIES
-- ============================================
ALTER TABLE public.user_client_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own client instances"
  ON public.user_client_instances
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own client instances"
  ON public.user_client_instances
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own client instances"
  ON public.user_client_instances
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own client instances"
  ON public.user_client_instances
  FOR DELETE USING (auth.uid() = user_id);
