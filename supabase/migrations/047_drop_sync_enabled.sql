-- Drop legacy sync_enabled master flag from google_calendar_connections.
-- The two directional flags (sync_app_to_google_enabled, sync_google_to_app_enabled)
-- are the actual gates used throughout sync logic. sync_enabled was only ever written
-- alongside them and never read as a condition.
ALTER TABLE public.google_calendar_connections DROP COLUMN IF EXISTS sync_enabled;
