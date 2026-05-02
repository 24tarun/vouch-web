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
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_proof_id uuid;
BEGIN
  SELECT id
  INTO v_proof_id
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
      updated_at = v_now
  WHERE id = p_task_id
    AND user_id = p_owner_id;

  UPDATE public.tasks
  SET proof_request_open = false,
      proof_requested_at = null,
      proof_requested_by = null,
      updated_at = v_now
  WHERE id = p_task_id
    AND user_id = p_owner_id
    AND status IN ('AWAITING_VOUCHER', 'AWAITING_AI', 'MARKED_COMPLETE');

  INSERT INTO public.task_events (
    task_id,
    event_type,
    actor_id,
    from_status,
    to_status,
    metadata
  )
  VALUES (
    p_task_id,
    'PROOF_UPLOADED',
    p_owner_id,
    p_task_status,
    p_task_status,
    jsonb_build_object(
      'media_kind', p_media_kind,
      'mime_type', p_mime_type,
      'size_bytes', p_size_bytes,
      'duration_ms', p_duration_ms
    )
  );

  RETURN QUERY SELECT true, null::text;
EXCEPTION
  WHEN OTHERS THEN
    RETURN QUERY SELECT false, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_task_proof_atomic(
  uuid, uuid, text, text, text, text, integer, integer, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_task_proof_atomic(
  uuid, uuid, text, text, text, text, integer, integer, text, text
) TO service_role;
