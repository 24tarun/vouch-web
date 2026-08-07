-- The native menu-bar companion records its client instance on the shared Vouch account.
ALTER TABLE public.user_client_instances
  DROP CONSTRAINT IF EXISTS user_client_instances_platform_check;

ALTER TABLE public.user_client_instances
  ADD CONSTRAINT user_client_instances_platform_check
  CHECK (platform = ANY (ARRAY['web', 'ios', 'android', 'macos']));
