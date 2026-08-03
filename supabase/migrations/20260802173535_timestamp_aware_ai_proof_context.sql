ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS original_deadline timestamptz;

UPDATE public.tasks
SET original_deadline = deadline
WHERE original_deadline IS NULL
  AND postponed_at IS NULL;

CREATE OR REPLACE FUNCTION private.preserve_task_original_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.original_deadline := NEW.deadline;
  ELSE
    NEW.original_deadline := OLD.original_deadline;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_preserve_original_deadline ON public.tasks;
CREATE TRIGGER tasks_preserve_original_deadline
BEFORE INSERT OR UPDATE OF original_deadline ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION private.preserve_task_original_deadline();

COMMENT ON COLUMN public.tasks.original_deadline IS
  'Backend-only audit deadline captured when the task is created. Legacy postponed tasks remain null when the prior deadline is unknowable.';

ALTER TABLE public.task_completion_proofs
  ADD COLUMN IF NOT EXISTS proof_origin text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS proof_timestamp_at timestamptz,
  ADD COLUMN IF NOT EXISTS proof_timestamp_source text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS proof_timezone text;

ALTER TABLE public.task_completion_proofs
  DROP CONSTRAINT IF EXISTS task_completion_proofs_origin_check,
  ADD CONSTRAINT task_completion_proofs_origin_check
    CHECK (proof_origin = ANY (ARRAY['CAMERA', 'LIBRARY', 'UNKNOWN'])),
  DROP CONSTRAINT IF EXISTS task_completion_proofs_timestamp_source_check,
  ADD CONSTRAINT task_completion_proofs_timestamp_source_check
    CHECK (proof_timestamp_source = ANY (ARRAY[
      'CAMERA_CAPTURE', 'EXIF', 'EMBEDDED_METADATA',
      'FILE_CREATION', 'FILE_MODIFICATION', 'ATTACHED', 'UNKNOWN'
    ])),
  DROP CONSTRAINT IF EXISTS task_completion_proofs_timestamp_presence_check,
  ADD CONSTRAINT task_completion_proofs_timestamp_presence_check
    CHECK (
      (proof_timestamp_source = 'UNKNOWN' AND proof_timestamp_at IS NULL AND proof_timezone IS NULL)
      OR
      (proof_timestamp_source <> 'UNKNOWN' AND proof_timestamp_at IS NOT NULL AND proof_timezone IS NOT NULL)
    ),
  DROP CONSTRAINT IF EXISTS task_completion_proofs_camera_timestamp_check,
  ADD CONSTRAINT task_completion_proofs_camera_timestamp_check
    CHECK (
      proof_timestamp_source <> 'CAMERA_CAPTURE'
      OR proof_origin = 'CAMERA'
    );

COMMENT ON COLUMN public.task_completion_proofs.proof_timestamp_at IS
  'Claimed media capture time, or attachment time when proof_timestamp_source is ATTACHED.';
COMMENT ON COLUMN public.task_completion_proofs.proof_timestamp_source IS
  'Describes whether proof_timestamp_at came from camera capture, media metadata, file metadata, or attachment fallback.';
COMMENT ON COLUMN public.task_completion_proofs.proof_timezone IS
  'Uploader IANA timezone used to render overlay_timestamp_text.';

CREATE OR REPLACE FUNCTION public.finalize_task_proof_atomic(
  p_task_id uuid,
  p_owner_id uuid,
  p_bucket text,
  p_object_path text,
  p_media_kind text,
  p_mime_type text,
  p_size_bytes integer,
  p_duration_ms integer,
  p_overlay_timestamp_text text,
  p_task_status text
)
RETURNS TABLE(success boolean, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := now();
  v_proof_id uuid;
  v_event_type text;
  v_request_id uuid;
  v_proof_origin text;
  v_proof_timestamp_at timestamptz;
  v_proof_timestamp_source text;
  v_proof_timezone text;
BEGIN
  SELECT
    id,
    proof_origin,
    proof_timestamp_at,
    proof_timestamp_source,
    proof_timezone
  INTO
    v_proof_id,
    v_proof_origin,
    v_proof_timestamp_at,
    v_proof_timestamp_source,
    v_proof_timezone
  FROM public.task_completion_proofs
  WHERE task_id = p_task_id
    AND owner_id = p_owner_id
    AND bucket = p_bucket
    AND object_path = p_object_path
    AND upload_state = 'PENDING'
  FOR UPDATE;

  IF v_proof_id IS NULL THEN
    RETURN QUERY SELECT false, 'Proof record not found or not pending.';
    RETURN;
  END IF;

  IF p_task_status NOT IN (
    'ACTIVE','POSTPONED','AWAITING_USER','AWAITING_VOUCHER','AWAITING_AI',
    'MARKED_COMPLETE','AWAITING_RECTIFICATION'
  ) THEN
    RETURN QUERY SELECT false, 'Task no longer accepts proof uploads.';
    RETURN;
  END IF;

  UPDATE public.task_completion_proofs
  SET media_kind = p_media_kind,
      mime_type = p_mime_type,
      size_bytes = p_size_bytes,
      duration_ms = p_duration_ms,
      overlay_timestamp_text = p_overlay_timestamp_text,
      upload_state = 'UPLOADED',
      updated_at = v_now
  WHERE id = v_proof_id
    AND owner_id = p_owner_id;

  UPDATE public.tasks
  SET has_proof = true,
      proof_request_open = false,
      proof_requested_at = NULL,
      proof_requested_by = NULL,
      updated_at = v_now
  WHERE id = p_task_id
    AND user_id = p_owner_id
    AND status = p_task_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task changed while proof was uploading';
  END IF;

  IF p_task_status = 'AWAITING_RECTIFICATION' THEN
    SELECT id INTO v_request_id
    FROM public.rectification_requests
    WHERE task_id = p_task_id
      AND private.rectification_open_state(state)
    ORDER BY created_at DESC
    LIMIT 1;
    v_event_type := 'RECTIFICATION_PROOF_UPLOADED';
  ELSE
    v_event_type := 'PROOF_UPLOADED';
  END IF;

  INSERT INTO public.task_events(
    task_id,
    event_type,
    actor_id,
    from_status,
    to_status,
    metadata
  )
  VALUES (
    p_task_id,
    v_event_type,
    p_owner_id,
    p_task_status,
    p_task_status,
    jsonb_build_object(
      'request_id', v_request_id,
      'media_kind', p_media_kind,
      'mime_type', p_mime_type,
      'size_bytes', p_size_bytes,
      'duration_ms', p_duration_ms,
      'proof_origin', v_proof_origin,
      'proof_timestamp_at', v_proof_timestamp_at,
      'proof_timestamp_source', v_proof_timestamp_source,
      'proof_timezone', v_proof_timezone
    )
  );

  RETURN QUERY SELECT true, NULL::text;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_task_proof_atomic(
  uuid, uuid, text, text, text, text, integer, integer, text, text
) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.finalize_task_proof_atomic(
  uuid, uuid, text, text, text, text, integer, integer, text, text
) TO service_role;
