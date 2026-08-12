-- A Pomodoro may be observed by every client on the account so concurrent
-- starts can be rejected, but only the client that created it may control its
-- timer.  Historical sessions remain nullable because they predate ownership.
ALTER TABLE public.pomo_sessions
  ADD COLUMN owner_user_client_instance_id uuid;

ALTER TABLE public.pomo_sessions
  ADD CONSTRAINT pomo_sessions_owner_user_client_instance_id_fkey
  FOREIGN KEY (owner_user_client_instance_id)
  REFERENCES public.user_client_instances (id)
  ON DELETE SET NULL;

CREATE INDEX pomo_sessions_owner_user_client_instance_id_idx
  ON public.pomo_sessions USING btree (owner_user_client_instance_id);

COMMENT ON COLUMN public.pomo_sessions.owner_user_client_instance_id IS
  'Client instance that exclusively displays and controls this Pomodoro timer.';
