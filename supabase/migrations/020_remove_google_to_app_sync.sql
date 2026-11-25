
DROP TABLE IF EXISTS public.google_calendar_sync_inbox;
DROP TABLE IF EXISTS public.google_calendar_event_tombstones;

ALTER TABLE public.google_calendar_connections
  DROP COLUMN IF EXISTS sync_google_to_app_enabled,
  DROP COLUMN IF EXISTS import_only_tagged_google_events,
  DROP COLUMN IF EXISTS sync_token,
  DROP COLUMN IF EXISTS watch_channel_id,
  DROP COLUMN IF EXISTS watch_resource_id,
  DROP COLUMN IF EXISTS watch_expires_at,
  DROP COLUMN IF EXISTS last_webhook_at,
  DROP COLUMN IF EXISTS last_sync_at;
