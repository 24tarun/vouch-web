-- Proof attachment state is intentionally independent from task status.
-- Removing proof only reopens a task when the owner had already submitted it
-- for review. Uploading/finalizing proof never marks a task complete.
CREATE OR REPLACE FUNCTION public.remove_task_proof_v2(
  p_task_id uuid,
  p_actor_user_client_instance_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_task public.tasks%ROWTYPE;
  v_proof public.task_completion_proofs%ROWTYPE;
  v_from_status text;
  v_to_status text;
  v_completion_undone boolean := false;
  v_ai_profile constant uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  IF v_actor IS NULL THEN
    RETURN private.task_command_error('UNAUTHENTICATED', 'Please sign in again and retry.');
  END IF;
  IF NOT private.task_command_valid_instance(v_actor, p_actor_user_client_instance_id) THEN
    RETURN private.task_command_error('FORBIDDEN', 'Invalid user client instance.');
  END IF;

  SELECT task.* INTO v_task
  FROM public.tasks AS task
  WHERE task.id = p_task_id AND task.user_id = v_actor
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN private.task_command_error('FORBIDDEN', 'Task not found.');
  END IF;
  IF v_task.status NOT IN (
    'ACTIVE', 'POSTPONED', 'AWAITING_USER', 'MARKED_COMPLETE',
    'AWAITING_VOUCHER', 'AWAITING_AI', 'AWAITING_RECTIFICATION'
  ) THEN
    RETURN private.task_command_error('STALE_STATUS', 'Proof can no longer be removed. Please refresh.');
  END IF;

  v_from_status := v_task.status;
  v_completion_undone := v_task.status IN ('MARKED_COMPLETE', 'AWAITING_VOUCHER', 'AWAITING_AI');

  IF v_completion_undone AND v_task.deadline + interval '1 minute' <= now() THEN
    RETURN private.task_command_error(
      'DEADLINE_PASSED',
      'The task deadline has passed. Proof and completion can no longer be changed.'
    );
  END IF;

  v_to_status := CASE
    WHEN v_completion_undone AND v_task.postponed_at IS NOT NULL THEN 'POSTPONED'
    WHEN v_completion_undone THEN 'ACTIVE'
    ELSE v_task.status
  END;

  SELECT proof.* INTO v_proof
  FROM public.task_completion_proofs AS proof
  WHERE proof.task_id = v_task.id AND proof.owner_id = v_actor
  FOR UPDATE;

  -- FAILED is the internal cleanup marker, not a task status or user-visible
  -- proof state. Keeping the row until Storage deletion succeeds lets the
  -- scheduled cleanup retry without orphaning the object.
  UPDATE public.task_completion_proofs AS proof
  SET upload_state = 'FAILED', updated_at = now()
  WHERE proof.task_id = v_task.id AND proof.owner_id = v_actor;

  UPDATE public.tasks AS task
  SET status = v_to_status,
      marked_completed_at = CASE WHEN v_completion_undone THEN NULL ELSE task.marked_completed_at END,
      voucher_response_deadline = CASE WHEN v_completion_undone THEN NULL ELSE task.voucher_response_deadline END,
      voucher_id = CASE
        WHEN v_completion_undone AND v_task.ai_escalated_from THEN v_ai_profile
        ELSE task.voucher_id
      END,
      ai_escalated_from = CASE WHEN v_completion_undone THEN false ELSE task.ai_escalated_from END,
      has_proof = false,
      proof_request_open = false,
      proof_requested_at = NULL,
      proof_requested_by = NULL,
      updated_at = now()
  WHERE task.id = v_task.id
  RETURNING task.* INTO v_task;

  INSERT INTO public.task_events(
    task_id, event_type, actor_id, actor_user_client_instance_id,
    from_status, to_status, metadata
  ) VALUES (
    v_task.id, 'PROOF_REMOVED', v_actor, p_actor_user_client_instance_id,
    v_from_status, v_to_status,
    jsonb_build_object('completion_undone', v_completion_undone)
  );

  IF v_completion_undone THEN
    PERFORM private.enqueue_task_calendar_upsert(v_task);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'task', to_jsonb(v_task),
    'fromStatus', v_from_status,
    'toStatus', v_to_status,
    'proofStorage', CASE
      WHEN v_proof.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'bucket', v_proof.bucket,
        'objectPath', v_proof.object_path
      )
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.remove_task_proof_v2(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_task_proof_v2(uuid, uuid) TO authenticated;
