-- Disallow voucher-driven task deletion at the database level.
-- 1) Remove direct DELETE permission for vouchers on assigned tasks.
-- 2) Prevent vouchers from setting tasks.status = 'DELETED' through UPDATE.
-- 3) Block new task_events rows with event_type = 'VOUCHER_DELETE'.

-- Remove legacy voucher DELETE policy.
DROP POLICY IF EXISTS "Vouchers can delete assigned tasks" ON public.tasks;

-- Recreate voucher UPDATE policy with an explicit WITH CHECK guard.
DROP POLICY IF EXISTS "Vouchers can update assigned tasks" ON public.tasks;
CREATE POLICY "Vouchers can update assigned tasks" ON public.tasks
  FOR UPDATE
  USING (auth.uid() = voucher_id)
  WITH CHECK (
    auth.uid() = voucher_id
    AND status <> 'DELETED'
  );

-- Keep legacy rows intact, but block new/updated rows from using VOUCHER_DELETE.
ALTER TABLE public.task_events
  DROP CONSTRAINT IF EXISTS task_events_no_voucher_delete_check;

ALTER TABLE public.task_events
  ADD CONSTRAINT task_events_no_voucher_delete_check
  CHECK (event_type <> 'VOUCHER_DELETE') NOT VALID;
