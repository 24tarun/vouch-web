-- Commitments core tables and policies

CREATE TABLE IF NOT EXISTS public.commitments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'FAILED')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT commitments_min_duration_check CHECK (end_date - start_date >= 3),
  CONSTRAINT commitments_name_not_blank CHECK (char_length(btrim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_commitments_user_id
  ON public.commitments(user_id);

DROP TRIGGER IF EXISTS commitments_updated_at ON public.commitments;
CREATE TRIGGER commitments_updated_at
  BEFORE UPDATE ON public.commitments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS public.commitment_task_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  commitment_id UUID NOT NULL REFERENCES public.commitments(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  recurrence_rule_id UUID REFERENCES public.recurrence_rules(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT commitment_task_links_exactly_one_target_check CHECK (
    (task_id IS NOT NULL AND recurrence_rule_id IS NULL)
    OR
    (task_id IS NULL AND recurrence_rule_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_commitment_task_links_unique_task
  ON public.commitment_task_links(commitment_id, task_id)
  WHERE task_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_commitment_task_links_unique_rule
  ON public.commitment_task_links(commitment_id, recurrence_rule_id)
  WHERE recurrence_rule_id IS NOT NULL;

ALTER TABLE public.commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commitment_task_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own commitments" ON public.commitments;
CREATE POLICY "Users can view own commitments" ON public.commitments
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own commitments" ON public.commitments;
CREATE POLICY "Users can insert own commitments" ON public.commitments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own commitments" ON public.commitments;
CREATE POLICY "Users can update own commitments" ON public.commitments
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own commitments" ON public.commitments;
CREATE POLICY "Users can delete own commitments" ON public.commitments
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own commitment links" ON public.commitment_task_links;
CREATE POLICY "Users can view own commitment links" ON public.commitment_task_links
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.commitments
      WHERE commitments.id = commitment_task_links.commitment_id
        AND commitments.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert own commitment links" ON public.commitment_task_links;
CREATE POLICY "Users can insert own commitment links" ON public.commitment_task_links
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.commitments
      WHERE commitments.id = commitment_task_links.commitment_id
        AND commitments.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update own commitment links" ON public.commitment_task_links;
CREATE POLICY "Users can update own commitment links" ON public.commitment_task_links
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM public.commitments
      WHERE commitments.id = commitment_task_links.commitment_id
        AND commitments.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.commitments
      WHERE commitments.id = commitment_task_links.commitment_id
        AND commitments.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete own commitment links" ON public.commitment_task_links;
CREATE POLICY "Users can delete own commitment links" ON public.commitment_task_links
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM public.commitments
      WHERE commitments.id = commitment_task_links.commitment_id
        AND commitments.user_id = auth.uid()
    )
  );

ALTER TABLE IF EXISTS public.commitments REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.commitment_task_links REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'commitments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.commitments;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'commitment_task_links'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.commitment_task_links;
  END IF;
END
$$;
