-- Optional completion proof media (image / short video)

CREATE TABLE IF NOT EXISTS task_completion_proofs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  voucher_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL DEFAULT 'task-proofs',
  object_path TEXT NOT NULL,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('image', 'video')),
  mime_type TEXT NOT NULL,
  size_bytes INT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  duration_ms INT CHECK (duration_ms IS NULL OR (duration_ms > 0 AND duration_ms <= 15000)),
  upload_state TEXT NOT NULL DEFAULT 'PENDING' CHECK (upload_state IN ('PENDING', 'UPLOADED', 'FAILED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id),
  UNIQUE (bucket, object_path)
);

CREATE INDEX IF NOT EXISTS idx_task_completion_proofs_voucher
  ON task_completion_proofs(voucher_id);

CREATE INDEX IF NOT EXISTS idx_task_completion_proofs_task
  ON task_completion_proofs(task_id);

CREATE INDEX IF NOT EXISTS idx_task_completion_proofs_state
  ON task_completion_proofs(upload_state, created_at);

ALTER TABLE task_completion_proofs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can view own task proofs" ON task_completion_proofs;
CREATE POLICY "Owners can view own task proofs" ON task_completion_proofs
  FOR SELECT USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Vouchers can view assigned task proofs" ON task_completion_proofs;
CREATE POLICY "Vouchers can view assigned task proofs" ON task_completion_proofs
  FOR SELECT USING (auth.uid() = voucher_id);

DROP POLICY IF EXISTS "Owners can insert own task proofs" ON task_completion_proofs;
CREATE POLICY "Owners can insert own task proofs" ON task_completion_proofs
  FOR INSERT WITH CHECK (
    auth.uid() = owner_id
    AND EXISTS (
      SELECT 1
      FROM tasks
      WHERE tasks.id = task_completion_proofs.task_id
      AND tasks.user_id = auth.uid()
      AND tasks.voucher_id = task_completion_proofs.voucher_id
    )
  );

DROP POLICY IF EXISTS "Owners can update own task proofs" ON task_completion_proofs;
CREATE POLICY "Owners can update own task proofs" ON task_completion_proofs
  FOR UPDATE USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Owners can delete own task proofs" ON task_completion_proofs;
CREATE POLICY "Owners can delete own task proofs" ON task_completion_proofs
  FOR DELETE USING (auth.uid() = owner_id);

DROP TRIGGER IF EXISTS task_completion_proofs_updated_at ON task_completion_proofs;
CREATE TRIGGER task_completion_proofs_updated_at
  BEFORE UPDATE ON task_completion_proofs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Private bucket for volatile proof media
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'task-proofs',
  'task-proofs',
  false,
  5242880,
  ARRAY[
    'image/jpg',
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/quicktime',
    'video/webm'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Owners can upload task proof objects" ON storage.objects;
CREATE POLICY "Owners can upload task proof objects" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'task-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM tasks
      WHERE tasks.id::text = (storage.foldername(name))[2]
      AND tasks.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can update task proof objects" ON storage.objects;
CREATE POLICY "Owners can update task proof objects" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'task-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'task-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Owners can delete task proof objects" ON storage.objects;
CREATE POLICY "Owners can delete task proof objects" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'task-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
