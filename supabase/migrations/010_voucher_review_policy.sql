-- Voucher review policy update:
-- 1) 7-day voucher review window handled in app code
-- 2) Daily digest dedupe table for voucher reminders
-- 3) Add voucher timeout penalty ledger entry type

-- ============================================
-- VOUCHER REMINDER LOGS (daily dedupe)
-- ============================================
CREATE TABLE IF NOT EXISTS voucher_reminder_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voucher_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reminder_date DATE NOT NULL,
  pending_count INT NOT NULL CHECK (pending_count >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (voucher_id, reminder_date)
);

ALTER TABLE voucher_reminder_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own voucher reminder logs" ON voucher_reminder_logs;
CREATE POLICY "Users can view own voucher reminder logs" ON voucher_reminder_logs
  FOR SELECT USING (auth.uid() = voucher_id);

DROP POLICY IF EXISTS "Users can insert own voucher reminder logs" ON voucher_reminder_logs;
CREATE POLICY "Users can insert own voucher reminder logs" ON voucher_reminder_logs
  FOR INSERT WITH CHECK (auth.uid() = voucher_id);

CREATE INDEX IF NOT EXISTS idx_voucher_reminder_logs_voucher_date
  ON voucher_reminder_logs (voucher_id, reminder_date);

-- ============================================
-- LEDGER ENTRY TYPE CONSTRAINT UPDATE
-- ============================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'ledger_entries'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%entry_type%'
  ) LOOP
    EXECUTE 'ALTER TABLE ledger_entries DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_entry_type_check
  CHECK (entry_type IN ('failure', 'rectified', 'force_majeure', 'voucher_timeout_penalty'));
