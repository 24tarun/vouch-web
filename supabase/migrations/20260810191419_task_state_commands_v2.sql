-- Additive, authoritative task-state commands for mobile/web clients.
-- Existing functions remain available for already-installed clients.

CREATE OR REPLACE FUNCTION private.task_command_error(p_code text, p_message text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'success', false,
    'code', p_code,
    'message', p_message
  );
$$;

CREATE OR REPLACE FUNCTION private.task_command_success(
  p_task public.tasks,
  p_from_status text,
  p_to_status text,
  p_deleted_task_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'success', true,
    'task', CASE WHEN p_deleted_task_id IS NULL THEN to_jsonb(p_task) ELSE NULL END,
    'deletedTaskId', p_deleted_task_id,
    'fromStatus', p_from_status,
    'toStatus', p_to_status
  );
$$;

CREATE OR REPLACE FUNCTION private.task_command_valid_instance(
  p_user_id uuid,
  p_instance_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT p_instance_id IS NULL OR EXISTS (
    SELECT 1
    FROM public.user_client_instances AS instance
    WHERE instance.id = p_instance_id
      AND instance.user_id = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION private.task_command_error(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.task_command_success(public.tasks, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.task_command_valid_instance(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.task_command_error(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.task_command_success(public.tasks, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.task_command_valid_instance(uuid, uuid) TO authenticated;

-- State commands enqueue Google Calendar persistence in the same transaction.
-- Dispatch remains an asynchronous, post-commit concern handled by the outbox
-- worker. This helper is owner-aware so voucher commands can enqueue for the
-- task owner without exposing the owner's calendar connection through RLS.
CREATE OR REPLACE FUNCTION private.enqueue_task_calendar_upsert(p_task public.tasks)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_connection public.google_calendar_connections%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR (v_actor <> p_task.user_id AND v_actor IS DISTINCT FROM p_task.voucher_id) THEN
    RAISE EXCEPTION 'Not authorized to enqueue task calendar sync.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks AS task
    WHERE task.id = p_task.id
      AND task.user_id = p_task.user_id
      AND task.voucher_id = p_task.voucher_id
  ) THEN
    RAISE EXCEPTION 'Task snapshot is not authoritative.' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(p_task.google_sync_for_task, false) THEN RETURN; END IF;

  SELECT connection.* INTO v_connection
  FROM public.google_calendar_connections AS connection
  WHERE connection.user_id = p_task.user_id;

  IF NOT FOUND
     OR v_connection.encrypted_refresh_token IS NULL
     OR NOT COALESCE(v_connection.sync_app_to_google_enabled, false)
     OR NULLIF(btrim(v_connection.selected_calendar_id), '') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.google_calendar_sync_outbox AS outbox
    WHERE outbox.user_id = p_task.user_id
      AND outbox.task_id = p_task.id
      AND outbox.intent = 'UPSERT'
      AND outbox.status IN ('PENDING', 'PROCESSING', 'FAILED')
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.google_calendar_sync_outbox(
    user_id, task_id, intent, status, next_attempt_at
  ) VALUES (
    p_task.user_id, p_task.id, 'UPSERT', 'PENDING', now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.enqueue_task_calendar_delete(p_task public.tasks)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_connection public.google_calendar_connections%ROWTYPE;
  v_google_event_id text;
  v_calendar_id text;
BEGIN
  IF v_actor IS NULL OR v_actor <> p_task.user_id THEN
    RAISE EXCEPTION 'Not authorized to enqueue task calendar deletion.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks AS task
    WHERE task.id = p_task.id AND task.user_id = p_task.user_id
  ) THEN
    RAISE EXCEPTION 'Task snapshot is not authoritative.' USING ERRCODE = '42501';
  END IF;

  SELECT link.google_event_id, link.calendar_id
  INTO v_google_event_id, v_calendar_id
  FROM public.google_calendar_task_links AS link
  WHERE link.task_id = p_task.id AND link.user_id = p_task.user_id;

  IF NULLIF(btrim(v_google_event_id), '') IS NULL THEN RETURN; END IF;

  SELECT connection.* INTO v_connection
  FROM public.google_calendar_connections AS connection
  WHERE connection.user_id = p_task.user_id;

  IF NOT FOUND
     OR v_connection.encrypted_refresh_token IS NULL
     OR NOT COALESCE(v_connection.sync_app_to_google_enabled, false) THEN
    RETURN;
  END IF;

  v_calendar_id := COALESCE(
    NULLIF(btrim(v_calendar_id), ''),
    NULLIF(btrim(v_connection.selected_calendar_id), '')
  );
  IF v_calendar_id IS NULL THEN RETURN; END IF;

  IF EXISTS (
    SELECT 1
    FROM public.google_calendar_sync_outbox AS outbox
    WHERE outbox.user_id = p_task.user_id
      AND outbox.task_id IS NULL
      AND outbox.intent = 'DELETE'
      AND outbox.status IN ('PENDING', 'PROCESSING', 'FAILED')
      AND COALESCE(outbox.payload->>'google_event_id', '') = v_google_event_id
      AND COALESCE(outbox.payload->>'calendar_id', '') = v_calendar_id
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.google_calendar_sync_outbox(
    user_id, task_id, intent, status, next_attempt_at, payload
  ) VALUES (
    p_task.user_id,
    NULL,
    'DELETE',
    'PENDING',
    now(),
    jsonb_build_object(
      'google_event_id', v_google_event_id,
      'calendar_id', v_calendar_id,
      'deleted_task_id', p_task.id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_task_calendar_upsert(public.tasks) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.enqueue_task_calendar_delete(public.tasks) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.enqueue_task_calendar_upsert(public.tasks) TO authenticated;
GRANT EXECUTE ON FUNCTION private.enqueue_task_calendar_delete(public.tasks) TO authenticated;

-- Queue compensation is one database transaction: release any reservation and
-- restore the authoritative task state together. The Edge orchestration calls
-- this only after Trigger.dev dispatch fails or quota cannot be reserved.
CREATE OR REPLACE FUNCTION public.rollback_ai_voucher_submission(
  p_user_id uuid,
  p_task_id uuid,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_previous_status text;
  v_has_prior_review boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.ai_vouches AS review WHERE review.task_id = p_task_id
  ) INTO v_has_prior_review;

  SELECT CASE
      WHEN v_has_prior_review THEN 'AWAITING_USER'
      WHEN task.postponed_at IS NULL THEN 'ACTIVE'
      ELSE 'POSTPONED'
    END
  INTO v_previous_status
  FROM public.tasks AS task
  WHERE task.id = p_task_id
    AND task.user_id = p_user_id
    AND task.status = 'AWAITING_AI'
  FOR UPDATE;

  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.ai_voucher_usage AS usage
  SET state = 'released',
      reserved_at = NULL,
      released_at = now(),
      updated_at = now()
  WHERE usage.task_id = p_task_id
    AND usage.user_id = p_user_id
    AND usage.state = 'reserved';

  UPDATE public.tasks AS task
  SET status = v_previous_status,
      marked_completed_at = CASE WHEN v_has_prior_review THEN task.marked_completed_at ELSE NULL END,
      updated_at = now()
  WHERE task.id = p_task_id
    AND task.user_id = p_user_id
    AND task.status = 'AWAITING_AI';

  IF NOT v_has_prior_review THEN
    INSERT INTO public.task_events(
      task_id, event_type, actor_id, from_status, to_status, metadata
    ) VALUES (
      p_task_id, 'UNDO_COMPLETE', p_user_id, 'AWAITING_AI', v_previous_status,
      jsonb_build_object('reason', p_reason)
    );
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.rollback_ai_voucher_submission(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_ai_voucher_submission(uuid, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_task_v2(
  p_task_id uuid,
  p_client_action_at timestamptz,
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
  v_now timestamptz := now();
  v_effective_at timestamptz;
  v_proof_at timestamptz;
  v_qualifying_at timestamptz;
  v_next_status text;
  v_timezone text := 'UTC';
  v_response_deadline timestamptz;
  v_pomo_seconds bigint := 0;
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
  IF v_task.status NOT IN ('ACTIVE', 'POSTPONED') THEN
    RETURN private.task_command_error('STALE_STATUS', 'Task can no longer be marked complete. Please refresh.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.task_subtasks AS subtask
    WHERE subtask.parent_task_id = v_task.id AND subtask.is_completed = false
  ) THEN
    RETURN private.task_command_error('INCOMPLETE_SUBTASKS', 'All subtasks must be completed first.');
  END IF;
  IF v_task.requires_proof AND NOT EXISTS (
    SELECT 1 FROM public.task_completion_proofs AS proof
    WHERE proof.task_id = v_task.id
      AND proof.upload_state = 'UPLOADED'
      AND proof.object_path IS NOT NULL
  ) THEN
    RETURN private.task_command_error('PROOF_REQUIRED', 'Please upload proof before marking this task complete.');
  END IF;

  IF p_client_action_at IS NOT NULL
     AND p_client_action_at <= v_now
     AND v_now - p_client_action_at <= interval '2 minutes' THEN
    v_effective_at := p_client_action_at;
  ELSE
    v_effective_at := v_now;
  END IF;

  IF v_task.is_strict AND v_task.start_at IS NOT NULL AND v_effective_at < v_task.start_at THEN
    RETURN private.task_command_error('STALE_STATUS', 'This strict task cannot be submitted before its start time.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.pomo_sessions AS session
    WHERE session.task_id = v_task.id
      AND session.user_id = v_actor
      AND session.status = 'ACTIVE'
  ) THEN
    RETURN private.task_command_error('STALE_STATUS', 'Finish the active Pomo before marking this task complete.');
  END IF;
  IF COALESCE(v_task.required_pomo_minutes, 0) > 0 THEN
    SELECT COALESCE(sum(session.elapsed_seconds), 0) INTO v_pomo_seconds
    FROM public.pomo_sessions AS session
    WHERE session.task_id = v_task.id
      AND session.user_id = v_actor
      AND session.status <> 'DELETED';
    IF v_pomo_seconds < v_task.required_pomo_minutes * 60 THEN
      RETURN private.task_command_error('STALE_STATUS', 'The required Pomo time has not been completed.');
    END IF;
  END IF;

  SELECT proof.proof_timestamp_at INTO v_proof_at
  FROM public.task_completion_proofs AS proof
  WHERE proof.task_id = v_task.id
    AND proof.upload_state = 'UPLOADED'
    AND proof.object_path IS NOT NULL
    AND proof.proof_origin = 'CAMERA'
    AND proof.proof_timestamp_source = 'CAMERA_CAPTURE'
  ORDER BY proof.proof_timestamp_at ASC
  LIMIT 1;

  v_qualifying_at := LEAST(v_effective_at, COALESCE(v_proof_at, v_effective_at));
  IF v_qualifying_at >= v_task.deadline + interval '1 minute' THEN
    RETURN private.task_command_error(
      'DEADLINE_PASSED',
      'The task deadline has passed. Proof and completion can no longer be changed.'
    );
  END IF;

  IF v_task.voucher_id = v_actor THEN
    v_next_status := 'ACCEPTED';
  ELSIF v_task.voucher_id = v_ai_profile THEN
    v_next_status := 'AWAITING_AI';
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.friendships AS friendship
      WHERE friendship.user_id = v_actor AND friendship.friend_id = v_task.voucher_id
    ) THEN
      RETURN private.task_command_error('FORBIDDEN', 'The assigned voucher is no longer your friend.');
    END IF;
    v_next_status := 'AWAITING_VOUCHER';
    SELECT COALESCE(profile.timezone, 'UTC') INTO v_timezone
    FROM public.profiles AS profile WHERE profile.id = v_actor;
    v_response_deadline := (
      ((v_effective_at AT TIME ZONE v_timezone)::date + 2) + time '23:59:59.999999'
    ) AT TIME ZONE v_timezone;
  END IF;

  UPDATE public.tasks AS task
  SET status = v_next_status,
      marked_completed_at = v_effective_at,
      voucher_response_deadline = v_response_deadline,
      has_proof = CASE WHEN v_next_status = 'ACCEPTED' THEN false ELSE task.has_proof END,
      proof_request_open = false,
      proof_requested_at = NULL,
      proof_requested_by = NULL,
      updated_at = v_now
  WHERE task.id = v_task.id
  RETURNING task.* INTO v_task;

  INSERT INTO public.task_events(
    task_id, event_type, actor_id, actor_user_client_instance_id,
    from_status, to_status, metadata
  ) VALUES (
    v_task.id, 'MARK_COMPLETE', v_actor, p_actor_user_client_instance_id,
    CASE WHEN v_task.postponed_at IS NULL THEN 'ACTIVE' ELSE 'POSTPONED' END,
    v_next_status,
    CASE WHEN v_next_status = 'ACCEPTED'
      THEN jsonb_build_object('self_vouched', true, 'auto_accepted', true)
      ELSE NULL
    END
  );

  PERFORM private.enqueue_task_calendar_upsert(v_task);
  RETURN private.task_command_success(
    v_task,
    CASE WHEN v_task.postponed_at IS NULL THEN 'ACTIVE' ELSE 'POSTPONED' END,
    v_next_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.postpone_task_v2(
  p_task_id uuid,
  p_new_deadline timestamptz,
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
  v_from_status text;
  v_now timestamptz := now();
  v_rule public.recurrence_rules%ROWTYPE;
  v_delta interval;
BEGIN
  IF v_actor IS NULL THEN RETURN private.task_command_error('UNAUTHENTICATED', 'Please sign in again and retry.'); END IF;
  IF NOT private.task_command_valid_instance(v_actor, p_actor_user_client_instance_id) THEN
    RETURN private.task_command_error('FORBIDDEN', 'Invalid user client instance.');
  END IF;
  IF p_new_deadline IS NULL OR p_new_deadline <= v_now THEN
    RETURN private.task_command_error('INVALID_DEADLINE', 'New deadline must be in the future.');
  END IF;

  SELECT task.* INTO v_task FROM public.tasks AS task
  WHERE task.id = p_task_id AND task.user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RETURN private.task_command_error('FORBIDDEN', 'Task not found.'); END IF;
  IF v_task.status NOT IN ('ACTIVE', 'POSTPONED') THEN
    RETURN private.task_command_error('STALE_STATUS', 'Task can no longer be postponed. Please refresh.');
  END IF;
  IF v_task.deadline + interval '1 minute' <= v_now THEN
    RETURN private.task_command_error('DEADLINE_PASSED', 'The task deadline has passed.');
  END IF;
  IF v_task.postponed_at IS NOT NULL THEN
    RETURN private.task_command_error('POSTPONE_USED', 'Task has already been postponed once.');
  END IF;

  IF v_task.recurrence_rule_id IS NOT NULL THEN
    SELECT rule.* INTO v_rule FROM public.recurrence_rules AS rule
    WHERE rule.id = v_task.recurrence_rule_id AND rule.user_id = v_actor;
    IF upper(COALESCE(v_rule.rule_config->>'frequency', '')) = 'DAILY'
       AND (v_task.deadline AT TIME ZONE COALESCE(v_rule.timezone, 'UTC'))::date
           <> (p_new_deadline AT TIME ZONE COALESCE(v_rule.timezone, 'UTC'))::date THEN
      RETURN private.task_command_error('INVALID_DEADLINE', 'Daily repeating tasks can only be postponed within the same day.');
    END IF;
  END IF;

  v_from_status := v_task.status;
  v_delta := p_new_deadline - v_task.deadline;

  UPDATE public.task_reminders AS reminder
  SET reminder_at = reminder.reminder_at + v_delta,
      notified_at = CASE WHEN reminder.reminder_at + v_delta > v_now THEN NULL ELSE v_now END,
      updated_at = v_now
  WHERE reminder.parent_task_id = v_task.id;

  UPDATE public.tasks AS task
  SET status = 'POSTPONED', deadline = p_new_deadline,
      postponed_at = v_now, updated_at = v_now
  WHERE task.id = v_task.id
  RETURNING task.* INTO v_task;

  INSERT INTO public.task_events(
    task_id, event_type, actor_id, actor_user_client_instance_id,
    from_status, to_status, metadata
  ) VALUES (
    v_task.id, 'POSTPONE', v_actor, p_actor_user_client_instance_id,
    v_from_status, 'POSTPONED',
    jsonb_build_object('previous_deadline', v_task.deadline - v_delta, 'new_deadline', v_task.deadline)
  );
  PERFORM private.enqueue_task_calendar_upsert(v_task);
  RETURN private.task_command_success(v_task, v_from_status, 'POSTPONED');
END;
$$;

CREATE OR REPLACE FUNCTION public.undo_task_completion_v2(
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
  v_from_status text;
  v_to_status text;
  v_ai_profile constant uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  IF v_actor IS NULL THEN RETURN private.task_command_error('UNAUTHENTICATED', 'Please sign in again and retry.'); END IF;
  IF NOT private.task_command_valid_instance(v_actor, p_actor_user_client_instance_id) THEN
    RETURN private.task_command_error('FORBIDDEN', 'Invalid user client instance.');
  END IF;
  SELECT task.* INTO v_task FROM public.tasks AS task
  WHERE task.id = p_task_id AND task.user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RETURN private.task_command_error('FORBIDDEN', 'Task not found.'); END IF;
  IF v_task.status NOT IN ('MARKED_COMPLETE', 'AWAITING_VOUCHER', 'AWAITING_AI', 'ACCEPTED') THEN
    RETURN private.task_command_error('STALE_STATUS', 'Task can no longer be reverted. Please refresh.');
  END IF;
  IF v_task.deadline + interval '1 minute' <= now() THEN
    RETURN private.task_command_error('DEADLINE_PASSED', 'The task deadline has passed. Proof and completion can no longer be changed.');
  END IF;
  v_from_status := v_task.status;
  v_to_status := CASE WHEN v_task.postponed_at IS NULL THEN 'ACTIVE' ELSE 'POSTPONED' END;

  UPDATE public.tasks AS task
  SET status = v_to_status,
      marked_completed_at = NULL,
      voucher_response_deadline = NULL,
      voucher_id = CASE WHEN v_task.ai_escalated_from THEN v_ai_profile ELSE v_task.voucher_id END,
      ai_escalated_from = false,
      proof_request_open = false,
      proof_requested_at = NULL,
      proof_requested_by = NULL,
      updated_at = now()
  WHERE task.id = v_task.id
  RETURNING task.* INTO v_task;

  INSERT INTO public.task_events(
    task_id, event_type, actor_id, actor_user_client_instance_id, from_status, to_status
  ) VALUES (v_task.id, 'UNDO_COMPLETE', v_actor, p_actor_user_client_instance_id, v_from_status, v_to_status);
  PERFORM private.enqueue_task_calendar_upsert(v_task);
  RETURN private.task_command_success(v_task, v_from_status, v_to_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_task_v2(
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
BEGIN
  IF v_actor IS NULL THEN RETURN private.task_command_error('UNAUTHENTICATED', 'Please sign in again and retry.'); END IF;
  IF NOT private.task_command_valid_instance(v_actor, p_actor_user_client_instance_id) THEN
    RETURN private.task_command_error('FORBIDDEN', 'Invalid user client instance.');
  END IF;
  SELECT task.* INTO v_task FROM public.tasks AS task
  WHERE task.id = p_task_id AND task.user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RETURN private.task_command_error('FORBIDDEN', 'Task not found.'); END IF;
  IF v_task.status NOT IN ('ACTIVE', 'POSTPONED') THEN
    RETURN private.task_command_error('STALE_STATUS', 'Task can no longer be deleted. Please refresh.');
  END IF;
  IF v_task.recurrence_rule_id IS NOT NULL THEN
    RETURN private.task_command_error('FORBIDDEN', 'Recurring task instances cannot be deleted.');
  END IF;
  IF v_task.created_at + interval '1 hour' <= now() THEN
    RETURN private.task_command_error('FORBIDDEN', 'Delete window expired. Tasks can only be deleted within 1 hour.');
  END IF;
  PERFORM private.enqueue_task_calendar_delete(v_task);
  DELETE FROM public.tasks AS task WHERE task.id = v_task.id;
  RETURN private.task_command_success(v_task, v_task.status, NULL, v_task.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.surrender_task_v2(
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
  v_from_status text;
BEGIN
  IF v_actor IS NULL THEN RETURN private.task_command_error('UNAUTHENTICATED', 'Please sign in again and retry.'); END IF;
  IF NOT private.task_command_valid_instance(v_actor, p_actor_user_client_instance_id) THEN
    RETURN private.task_command_error('FORBIDDEN', 'Invalid user client instance.');
  END IF;
  SELECT task.* INTO v_task FROM public.tasks AS task
  WHERE task.id = p_task_id AND task.user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RETURN private.task_command_error('FORBIDDEN', 'Task not found.'); END IF;
  IF v_task.status NOT IN ('ACTIVE', 'POSTPONED') THEN
    RETURN private.task_command_error('STALE_STATUS', 'Task can no longer be surrendered. Please refresh.');
  END IF;
  IF v_task.created_at > now() - interval '1 hour' THEN
    RETURN private.task_command_error('FORBIDDEN', 'Tasks can only be surrendered after the 1 hour delete window expires.');
  END IF;
  v_from_status := v_task.status;
  UPDATE public.tasks AS task
  SET status = 'SURRENDERED', has_proof = false,
      proof_request_open = false, proof_requested_at = NULL, proof_requested_by = NULL,
      updated_at = now()
  WHERE task.id = v_task.id
  RETURNING task.* INTO v_task;
  INSERT INTO public.task_events(
    task_id, event_type, actor_id, actor_user_client_instance_id,
    from_status, to_status, metadata
  ) VALUES (
    v_task.id, 'SURRENDER', v_actor, p_actor_user_client_instance_id,
    v_from_status, 'SURRENDERED', jsonb_build_object('reason', 'Voluntarily surrendered by task owner')
  );
  PERFORM private.enqueue_task_calendar_upsert(v_task);
  RETURN private.task_command_success(v_task, v_from_status, 'SURRENDERED');
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_voucher_task_v2(
  p_task_id uuid,
  p_decision text,
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
  v_from_status text;
  v_to_status text;
BEGIN
  IF v_actor IS NULL THEN RETURN private.task_command_error('UNAUTHENTICATED', 'Please sign in again and retry.'); END IF;
  IF NOT private.task_command_valid_instance(v_actor, p_actor_user_client_instance_id) THEN
    RETURN private.task_command_error('FORBIDDEN', 'Invalid user client instance.');
  END IF;
  IF upper(COALESCE(p_decision, '')) NOT IN ('ACCEPT', 'DENY') THEN
    RETURN private.task_command_error('STALE_STATUS', 'Invalid voucher decision.');
  END IF;
  SELECT task.* INTO v_task FROM public.tasks AS task
  WHERE task.id = p_task_id AND task.voucher_id = v_actor AND task.user_id <> v_actor FOR UPDATE;
  IF NOT FOUND THEN RETURN private.task_command_error('FORBIDDEN', 'Task not found or you are not the voucher.'); END IF;
  IF v_task.status NOT IN ('AWAITING_VOUCHER', 'MARKED_COMPLETE') THEN
    RETURN private.task_command_error('STALE_STATUS', 'This task is no longer waiting for your review.');
  END IF;
  v_from_status := v_task.status;
  v_to_status := CASE WHEN upper(p_decision) = 'ACCEPT' THEN 'ACCEPTED' ELSE 'DENIED' END;

  UPDATE public.tasks AS task
  SET status = v_to_status, has_proof = false,
      proof_request_open = false, proof_requested_at = NULL, proof_requested_by = NULL,
      updated_at = now()
  WHERE task.id = v_task.id
  RETURNING task.* INTO v_task;

  INSERT INTO public.task_events(
    task_id, event_type, actor_id, actor_user_client_instance_id, from_status, to_status
  ) VALUES (
    v_task.id,
    CASE WHEN v_to_status = 'ACCEPTED' THEN 'VOUCHER_ACCEPT' ELSE 'VOUCHER_DENY' END,
    v_actor, p_actor_user_client_instance_id, v_from_status, v_to_status
  );
  PERFORM private.enqueue_task_calendar_upsert(v_task);
  RETURN private.task_command_success(v_task, v_from_status, v_to_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_ai_appeal_v2(
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
  v_ai_profile constant uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  IF v_actor IS NULL THEN RETURN private.task_command_error('UNAUTHENTICATED', 'Please sign in again and retry.'); END IF;
  IF NOT private.task_command_valid_instance(v_actor, p_actor_user_client_instance_id) THEN
    RETURN private.task_command_error('FORBIDDEN', 'Invalid user client instance.');
  END IF;
  SELECT task.* INTO v_task FROM public.tasks AS task
  WHERE task.id = p_task_id AND task.user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RETURN private.task_command_error('FORBIDDEN', 'Task not found.'); END IF;
  IF v_task.status <> 'AWAITING_USER' OR v_task.voucher_id <> v_ai_profile THEN
    RETURN private.task_command_error('STALE_STATUS', 'Task is no longer awaiting an AI appeal.');
  END IF;
  IF v_task.resubmit_count >= 3 THEN
    RETURN private.task_command_error('QUOTA_EXHAUSTED', 'All AI appeal attempts have been used.');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.task_completion_proofs AS proof
    WHERE proof.task_id = v_task.id AND proof.upload_state = 'UPLOADED' AND proof.object_path IS NOT NULL
  ) THEN
    RETURN private.task_command_error('PROOF_REQUIRED', 'Upload proof before submitting to AI.');
  END IF;
  UPDATE public.tasks AS task SET status = 'AWAITING_AI', updated_at = now()
  WHERE task.id = v_task.id RETURNING task.* INTO v_task;
  INSERT INTO public.task_events(
    task_id, event_type, actor_id, actor_user_client_instance_id, from_status, to_status,
    metadata
  ) VALUES (
    v_task.id, 'RESUBMIT_TO_AI', v_actor, p_actor_user_client_instance_id,
    'AWAITING_USER', 'AWAITING_AI', jsonb_build_object('ai_appeal', true)
  );
  PERFORM private.enqueue_task_calendar_upsert(v_task);
  RETURN private.task_command_success(v_task, 'AWAITING_USER', 'AWAITING_AI');
END;
$$;

CREATE OR REPLACE FUNCTION public.escalate_ai_task_v2(
  p_task_id uuid,
  p_friend_id uuid,
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
  v_timezone text := 'UTC';
  v_ai_profile constant uuid := '11111111-1111-1111-1111-111111111111';
  v_deadline timestamptz;
BEGIN
  IF v_actor IS NULL THEN RETURN private.task_command_error('UNAUTHENTICATED', 'Please sign in again and retry.'); END IF;
  IF NOT private.task_command_valid_instance(v_actor, p_actor_user_client_instance_id) THEN
    RETURN private.task_command_error('FORBIDDEN', 'Invalid user client instance.');
  END IF;
  IF p_friend_id IS NULL OR p_friend_id IN (v_actor, v_ai_profile) OR NOT EXISTS (
    SELECT 1 FROM public.friendships AS friendship
    WHERE friendship.user_id = v_actor AND friendship.friend_id = p_friend_id
  ) THEN
    RETURN private.task_command_error('FORBIDDEN', 'Please choose one of your friends.');
  END IF;
  SELECT task.* INTO v_task FROM public.tasks AS task
  WHERE task.id = p_task_id AND task.user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RETURN private.task_command_error('FORBIDDEN', 'Task not found.'); END IF;
  IF v_task.status <> 'AWAITING_USER' OR v_task.voucher_id <> v_ai_profile OR v_task.ai_escalated_from THEN
    RETURN private.task_command_error('STALE_STATUS', 'Task is no longer eligible for AI escalation.');
  END IF;

  UPDATE public.task_completion_proofs AS proof
  SET voucher_id = p_friend_id, updated_at = now()
  WHERE proof.task_id = v_task.id AND proof.owner_id = v_actor;

  SELECT COALESCE(profile.timezone, 'UTC') INTO v_timezone
  FROM public.profiles AS profile WHERE profile.id = v_actor;
  v_deadline := ((((now() AT TIME ZONE v_timezone)::date + 2) + time '23:59:59.999999') AT TIME ZONE v_timezone);

  UPDATE public.tasks AS task
  SET voucher_id = p_friend_id, ai_escalated_from = true,
      status = 'AWAITING_VOUCHER', voucher_response_deadline = v_deadline,
      updated_at = now()
  WHERE task.id = v_task.id RETURNING task.* INTO v_task;
  INSERT INTO public.task_events(
    task_id, event_type, actor_id, actor_user_client_instance_id,
    from_status, to_status, metadata
  ) VALUES (
    v_task.id, 'AI_ESCALATE_TO_HUMAN', v_actor, p_actor_user_client_instance_id,
    'AWAITING_USER', 'AWAITING_VOUCHER', jsonb_build_object('new_voucher_id', p_friend_id)
  );
  PERFORM private.enqueue_task_calendar_upsert(v_task);
  RETURN private.task_command_success(v_task, 'AWAITING_USER', 'AWAITING_VOUCHER');
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_ai_denial_v2(
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
BEGIN
  IF v_actor IS NULL THEN RETURN private.task_command_error('UNAUTHENTICATED', 'Please sign in again and retry.'); END IF;
  IF NOT private.task_command_valid_instance(v_actor, p_actor_user_client_instance_id) THEN
    RETURN private.task_command_error('FORBIDDEN', 'Invalid user client instance.');
  END IF;
  SELECT task.* INTO v_task FROM public.tasks AS task
  WHERE task.id = p_task_id AND task.user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RETURN private.task_command_error('FORBIDDEN', 'Task not found.'); END IF;
  IF v_task.status <> 'AWAITING_USER' THEN
    RETURN private.task_command_error('STALE_STATUS', 'Task is no longer awaiting your decision.');
  END IF;
  UPDATE public.tasks AS task
  SET status = 'DENIED', has_proof = false,
      proof_request_open = false, proof_requested_at = NULL, proof_requested_by = NULL,
      updated_at = now()
  WHERE task.id = v_task.id RETURNING task.* INTO v_task;
  INSERT INTO public.task_events(
    task_id, event_type, actor_id, actor_user_client_instance_id, from_status, to_status
  ) VALUES (v_task.id, 'ACCEPT_DENIAL', v_actor, p_actor_user_client_instance_id, 'AWAITING_USER', 'DENIED');
  PERFORM private.enqueue_task_calendar_upsert(v_task);
  RETURN private.task_command_success(v_task, 'AWAITING_USER', 'DENIED');
END;
$$;

CREATE OR REPLACE FUNCTION public.override_task_v2(
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
  v_from_status text;
  v_timezone text := 'UTC';
  v_period text;
  v_failure_period text;
BEGIN
  IF v_actor IS NULL THEN RETURN private.task_command_error('UNAUTHENTICATED', 'Please sign in again and retry.'); END IF;
  IF NOT private.task_command_valid_instance(v_actor, p_actor_user_client_instance_id) THEN
    RETURN private.task_command_error('FORBIDDEN', 'Invalid user client instance.');
  END IF;
  SELECT task.* INTO v_task FROM public.tasks AS task
  WHERE task.id = p_task_id AND task.user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RETURN private.task_command_error('FORBIDDEN', 'Task not found.'); END IF;
  IF v_task.status NOT IN ('DENIED', 'MISSED', 'SURRENDERED') THEN
    RETURN private.task_command_error('STALE_STATUS', 'Only denied, missed, or surrendered tasks can be overridden.');
  END IF;
  SELECT COALESCE(profile.timezone, 'UTC') INTO v_timezone
  FROM public.profiles AS profile WHERE profile.id = v_actor;
  v_period := to_char(now() AT TIME ZONE v_timezone, 'YYYY-MM');
  SELECT ledger.period INTO v_failure_period FROM public.ledger_entries AS ledger
  WHERE ledger.task_id = v_task.id
    AND ledger.entry_type IN ('denied', 'missed', 'surrendered')
  ORDER BY ledger.created_at DESC LIMIT 1;
  IF v_failure_period IS NULL OR v_failure_period <> v_period THEN
    RETURN private.task_command_error('FORBIDDEN', 'Override can only be applied in the failure month.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.overrides AS item WHERE item.user_id = v_actor AND item.period = v_period) THEN
    RETURN private.task_command_error('QUOTA_EXHAUSTED', 'You have already used your override for this month.');
  END IF;
  v_from_status := v_task.status;
  INSERT INTO public.overrides(user_id, task_id, period) VALUES (v_actor, v_task.id, v_period);
  INSERT INTO public.ledger_entries(user_id, task_id, period, amount_cents, entry_type)
  VALUES (v_actor, v_task.id, v_period, -v_task.failure_cost_cents, 'override');
  UPDATE public.tasks AS task SET status = 'SETTLED', has_proof = false, updated_at = now()
  WHERE task.id = v_task.id RETURNING task.* INTO v_task;
  INSERT INTO public.task_events(
    task_id, event_type, actor_id, actor_user_client_instance_id, from_status, to_status
  ) VALUES (v_task.id, 'OVERRIDE', v_actor, p_actor_user_client_instance_id, v_from_status, 'SETTLED');
  PERFORM private.enqueue_task_calendar_upsert(v_task);
  RETURN private.task_command_success(v_task, v_from_status, 'SETTLED');
END;
$$;

REVOKE ALL ON FUNCTION public.complete_task_v2(uuid, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.postpone_task_v2(uuid, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.undo_task_completion_v2(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_task_v2(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.surrender_task_v2(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_voucher_task_v2(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_ai_appeal_v2(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.escalate_ai_task_v2(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_ai_denial_v2(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.override_task_v2(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.complete_task_v2(uuid, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.postpone_task_v2(uuid, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_task_completion_v2(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_task_v2(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.surrender_task_v2(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_voucher_task_v2(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_ai_appeal_v2(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.escalate_ai_task_v2(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_ai_denial_v2(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.override_task_v2(uuid, uuid) TO authenticated;
