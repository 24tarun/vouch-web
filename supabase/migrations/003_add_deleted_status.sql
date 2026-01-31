-- Add DELETED status to the tasks.status check constraint
-- This script automatically finds the existing (possibly auto-named) constraint and replaces it.
-- Run in Supabase SQL editor

DO $$ 
DECLARE 
    r RECORD;
BEGIN
    FOR r IN (SELECT conname 
              FROM pg_constraint 
              WHERE conrelid = 'tasks'::regclass 
              AND contype = 'c' 
              AND pg_get_constraintdef(oid) LIKE '%status%') 
    LOOP
        EXECUTE 'ALTER TABLE tasks DROP CONSTRAINT ' || quote_ident(r.conname);
    END LOOP;
END $$;

ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN (
  'CREATED', 'ACTIVE', 'POSTPONED', 'MARKED_COMPLETED',
  'AWAITING_VOUCHER', 'COMPLETED', 'FAILED', 'RECTIFIED', 'DELETED', 'SETTLED'
));
