-- Allow vouchers to delete tasks they are assigned to
-- Run in Supabase SQL editor or via supabase db push

-- RLS policy: vouchers can delete assigned tasks
CREATE POLICY "Vouchers can delete assigned tasks" ON tasks
  FOR DELETE USING (auth.uid() = voucher_id);
