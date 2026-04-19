-- Allow authenticated users to read proof objects via signed URLs.
-- Object path format is enforced by edge function:
--   <owner_id>/<task_id>/<random>.<ext>

DROP POLICY IF EXISTS "Task proof owners can read objects" ON storage.objects;
CREATE POLICY "Task proof owners can read objects"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'task-proofs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Task proof vouchers can read objects" ON storage.objects;
CREATE POLICY "Task proof vouchers can read objects"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'task-proofs'
    AND EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id::text = (storage.foldername(name))[2]
        AND t.user_id::text = (storage.foldername(name))[1]
        AND t.voucher_id = auth.uid()
    )
  );
