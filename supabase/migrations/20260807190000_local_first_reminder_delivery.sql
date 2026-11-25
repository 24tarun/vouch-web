
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

CREATE UNIQUE INDEX idx_reminder_invalidations_pending_instance
  ON public.reminder_invalidations USING btree (user_client_instance_id)
  WHERE dispatched_at IS NULL;

CREATE INDEX idx_reminder_invalidations_pending
  ON public.reminder_invalidations USING btree (created_at)
  WHERE dispatched_at IS NULL;

ALTER TABLE public.reminder_invalidations ENABLE ROW LEVEL SECURITY;


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

CREATE TRIGGER trg_enqueue_reminder_invalidations_on_delete
  BEFORE DELETE ON public.task_reminders
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_reminder_invalidations();

CREATE TRIGGER trg_enqueue_reminder_invalidations_on_reschedule
  AFTER UPDATE OF reminder_at ON public.task_reminders
  FOR EACH ROW
  WHEN (OLD.reminder_at IS DISTINCT FROM NEW.reminder_at)
  EXECUTE FUNCTION public.enqueue_reminder_invalidations();
