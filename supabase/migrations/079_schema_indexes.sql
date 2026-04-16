--
-- 079: All non-PK / non-unique-constraint indexes
--

-- ai_vouches
CREATE INDEX IF NOT EXISTS ai_vouches_task_id_idx
  ON public.ai_vouches USING btree (task_id);

-- commitment_task_links (partial unique indexes)
CREATE UNIQUE INDEX IF NOT EXISTS idx_commitment_task_links_unique_task
  ON public.commitment_task_links USING btree (commitment_id, task_id)
  WHERE task_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_commitment_task_links_unique_rule
  ON public.commitment_task_links USING btree (commitment_id, recurrence_rule_id)
  WHERE recurrence_rule_id IS NOT NULL;

-- commitments
CREATE INDEX IF NOT EXISTS idx_commitments_user_id
  ON public.commitments USING btree (user_id);

-- friendships
CREATE INDEX IF NOT EXISTS idx_friendships_user_id
  ON public.friendships USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_friendships_friend_id
  ON public.friendships USING btree (friend_id);

-- google_calendar_sync_outbox
CREATE INDEX IF NOT EXISTS idx_google_calendar_outbox_pending
  ON public.google_calendar_sync_outbox USING btree (status, next_attempt_at)
  WHERE status = ANY (ARRAY['PENDING','FAILED']);

CREATE INDEX IF NOT EXISTS idx_google_calendar_outbox_user
  ON public.google_calendar_sync_outbox USING btree (user_id);

-- google_calendar_task_links
CREATE INDEX IF NOT EXISTS idx_google_calendar_task_links_event
  ON public.google_calendar_task_links USING btree (user_id, calendar_id, google_event_id);

CREATE INDEX IF NOT EXISTS idx_google_calendar_task_links_user_id
  ON public.google_calendar_task_links USING btree (user_id);

-- ledger_entries
CREATE INDEX IF NOT EXISTS idx_ledger_user_period
  ON public.ledger_entries USING btree (user_id, period);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_task_id
  ON public.ledger_entries USING btree (task_id);

-- overrides
CREATE INDEX IF NOT EXISTS idx_force_majeure_user_period
  ON public.overrides USING btree (user_id, period);

-- pomo_sessions
CREATE INDEX IF NOT EXISTS idx_pomo_sessions_task_id
  ON public.pomo_sessions USING btree (task_id);

CREATE INDEX IF NOT EXISTS idx_pomo_sessions_active_by_task
  ON public.pomo_sessions USING btree (task_id, elapsed_seconds)
  WHERE status <> 'DELETED';

CREATE UNIQUE INDEX IF NOT EXISTS idx_single_active_or_paused_pomo
  ON public.pomo_sessions USING btree (user_id)
  WHERE status = ANY (ARRAY['ACTIVE','PAUSED']);

-- rectify_passes
CREATE INDEX IF NOT EXISTS idx_rectify_passes_user_period
  ON public.rectify_passes USING btree (user_id, period);

-- task_completion_proofs
CREATE INDEX IF NOT EXISTS idx_task_completion_proofs_task
  ON public.task_completion_proofs USING btree (task_id);

CREATE INDEX IF NOT EXISTS idx_task_completion_proofs_voucher
  ON public.task_completion_proofs USING btree (voucher_id);

CREATE INDEX IF NOT EXISTS idx_task_completion_proofs_state
  ON public.task_completion_proofs USING btree (upload_state, created_at);

-- task_events
CREATE INDEX IF NOT EXISTS idx_task_events_task_id
  ON public.task_events USING btree (task_id);

CREATE INDEX IF NOT EXISTS idx_task_events_task_event_type
  ON public.task_events USING btree (task_id, event_type);

-- task_reminders
CREATE INDEX IF NOT EXISTS idx_task_reminders_due
  ON public.task_reminders USING btree (reminder_at)
  WHERE notified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_task_reminders_parent_reminder
  ON public.task_reminders USING btree (parent_task_id, reminder_at);

-- task_subtasks
CREATE INDEX IF NOT EXISTS idx_task_subtasks_parent_task_id
  ON public.task_subtasks USING btree (parent_task_id);

CREATE INDEX IF NOT EXISTS idx_task_subtasks_parent_created_at
  ON public.task_subtasks USING btree (parent_task_id, created_at);

-- tasks
CREATE INDEX IF NOT EXISTS idx_tasks_user_id
  ON public.tasks USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_tasks_voucher_id
  ON public.tasks USING btree (voucher_id);

CREATE INDEX IF NOT EXISTS idx_tasks_voucher_status
  ON public.tasks USING btree (voucher_id, status);

CREATE INDEX IF NOT EXISTS idx_tasks_deadline
  ON public.tasks USING btree (deadline);

CREATE INDEX IF NOT EXISTS idx_tasks_active_deadline
  ON public.tasks USING btree (deadline)
  WHERE status = ANY (ARRAY['ACTIVE','POSTPONED']);

CREATE INDEX IF NOT EXISTS idx_tasks_awaiting_voucher_deadline
  ON public.tasks USING btree (voucher_response_deadline)
  WHERE status = 'AWAITING_VOUCHER';

CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_rule_id
  ON public.tasks USING btree (recurrence_rule_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_recurrence_rule_iteration
  ON public.tasks USING btree (recurrence_rule_id, iteration_number)
  WHERE recurrence_rule_id IS NOT NULL AND iteration_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_owner_open_proof_requests
  ON public.tasks USING btree (user_id)
  WHERE proof_request_open = true
    AND status = ANY (ARRAY['AWAITING_VOUCHER','AWAITING_AI','MARKED_COMPLETE']);

-- voucher_reminder_logs
CREATE INDEX IF NOT EXISTS idx_voucher_reminder_logs_voucher_date
  ON public.voucher_reminder_logs USING btree (voucher_id, reminder_date);
