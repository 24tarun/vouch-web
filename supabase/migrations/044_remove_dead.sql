-- Migration: 044_drop_dead_columns.sql

-- 1. Drop dead column: profiles.internal_calendar_enabled
ALTER TABLE public.profiles DROP COLUMN IF EXISTS internal_calendar_enabled;

-- 2. Drop dead column: tasks.start_at
ALTER TABLE public.tasks DROP COLUMN IF EXISTS start_at;

-- 3. Drop vestigial column: google_calendar_sync_outbox.payload
ALTER TABLE public.google_calendar_sync_outbox DROP COLUMN IF EXISTS payload;