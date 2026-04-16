-- Allow vouchers to generate signed URLs for (and read) proof objects
-- they are assigned to. Without this, mobile clients calling
-- supabase.storage.createSignedUrl() as the voucher get a silent error
-- because the task-proofs bucket only had owner-scoped SELECT policies.
--
-- Web is unaffected (it proxies through an admin-client server route),
-- but mobile calls storage directly with the user's JWT.

CREATE POLICY "Vouchers can read assigned task proof objects"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'task-proofs'
  AND EXISTS (
    SELECT 1 FROM public.task_completion_proofs tcp
    WHERE tcp.object_path = storage.objects.name
      AND tcp.voucher_id = auth.uid()
  )
);
