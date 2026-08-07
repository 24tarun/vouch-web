-- Local-first reminder delivery.
--
-- Reminders are now scheduled directly on-device so they fire at the exact
-- deadline second instead of arriving 30-60s late through the per-minute cron
-- -> Expo -> APNs path. To keep exactly one notification per device, a device
-- records a *claim* for every reminder it has handed to its OS scheduler; the
-- reminder cron then skips pushing to any device holding a live claim and
-- still pushes to every device that has none.
--
-- `armed_until` is a lease. A device that stops syncing (uninstalled,
-- notification permission revoked, powered off) lets its claims age out, and
-- the cron resumes pushing to it. Local scheduling failing silently therefore
-- degrades to a late push rather than to no notification at all.

CREATE TABLE public.reminder_device_claims (
  reminder_id             uuid        NOT NULL,
  user_id                 uuid        NOT NULL,
  user_client_instance_id uuid        NOT NULL,
  armed_until             timestamptz NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reminder_device_claims_pkey
    PRIMARY KEY (reminder_id, user_client_instance_id),
  CONSTRAINT reminder_device_claims_reminder_id_fkey
    FOREIGN KEY (reminder_id) REFERENCES public.task_reminders (id) ON DELETE CASCADE,
  CONSTRAINT reminder_device_claims_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT reminder_device_claims_client_instance_fkey
    FOREIGN KEY (user_client_instance_id, user_id)
      REFERENCES public.user_client_instances (id, user_id) ON DELETE CASCADE
);

-- The cron's only read pattern: given a batch of due reminder ids, which
-- devices already have them armed?
CREATE INDEX idx_reminder_device_claims_live
  ON public.reminder_device_claims USING btree (reminder_id, armed_until);

CREATE INDEX idx_reminder_device_claims_instance
  ON public.reminder_device_claims USING btree (user_client_instance_id);

CREATE TRIGGER reminder_device_claims_updated_at
  BEFORE UPDATE ON public.reminder_device_claims
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.reminder_device_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY reminder_device_claims_select_own
  ON public.reminder_device_claims FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY reminder_device_claims_insert_own
  ON public.reminder_device_claims FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY reminder_device_claims_update_own
  ON public.reminder_device_claims FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY reminder_device_claims_delete_own
  ON public.reminder_device_claims FOR DELETE USING (auth.uid() = user_id);


-- Outbox of "a device is holding a reminder that no longer exists as it armed
-- it" events. Drained by a background job that sends a silent data push so the
-- device wakes and re-syncs. Needed because a device that was offline when the
-- user postponed a task from another client still has the old alarm loaded
-- into its OS scheduler, and iOS will not run app code before firing it.
CREATE TABLE public.reminder_invalidations (
  id                      bigserial   NOT NULL,
  user_id                 uuid        NOT NULL,
  user_client_instance_id uuid        NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  dispatched_at           timestamptz,
  CONSTRAINT reminder_invalidations_pkey PRIMARY KEY (id),
  CONSTRAINT reminder_invalidations_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE
);

-- One pending wake-up per device: postponing a task invalidates its 1h/10m/due
-- reminders at once, and the device only needs to be told to re-sync once.
CREATE UNIQUE INDEX idx_reminder_invalidations_pending_instance
  ON public.reminder_invalidations USING btree (user_client_instance_id)
  WHERE dispatched_at IS NULL;

CREATE INDEX idx_reminder_invalidations_pending
  ON public.reminder_invalidations USING btree (created_at)
  WHERE dispatched_at IS NULL;

ALTER TABLE public.reminder_invalidations ENABLE ROW LEVEL SECURITY;
-- No policies: written by trigger (SECURITY DEFINER), read by the drain job
-- through the service role. Clients never touch it directly.


CREATE OR REPLACE FUNCTION public.enqueue_reminder_invalidations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_reminder_id uuid;
BEGIN
  target_reminder_id := COALESCE(OLD.id, NEW.id);

  INSERT INTO public.reminder_invalidations (user_id, user_client_instance_id)
  SELECT claim.user_id, claim.user_client_instance_id
  FROM public.reminder_device_claims AS claim
  WHERE claim.reminder_id = target_reminder_id
    AND claim.armed_until > now()
  ON CONFLICT (user_client_instance_id) WHERE dispatched_at IS NULL DO NOTHING;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- BEFORE DELETE, not AFTER: the claim rows are gone by the time an AFTER
-- trigger runs, since they cascade off the reminder being deleted.
CREATE TRIGGER trg_enqueue_reminder_invalidations_on_delete
  BEFORE DELETE ON public.task_reminders
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_reminder_invalidations();

-- A reminder that moved is as stale on-device as one that was deleted.
CREATE TRIGGER trg_enqueue_reminder_invalidations_on_reschedule
  AFTER UPDATE OF reminder_at ON public.task_reminders
  FOR EACH ROW
  WHEN (OLD.reminder_at IS DISTINCT FROM NEW.reminder_at)
  EXECUTE FUNCTION public.enqueue_reminder_invalidations();
