--
-- 076: Extensions and Functions
-- Canonical schema dump from live Supabase DB (2026-03-26)
-- Apply 076–081 on a fresh Supabase project to recreate the full schema.
--

-- ============================================
-- EXTENSIONS (enabled by default on Supabase)
-- ============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"      WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto"        WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pg_graphql"      WITH SCHEMA graphql;
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "supabase_vault"  WITH SCHEMA vault;

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Get current period (YYYY-MM)
CREATE OR REPLACE FUNCTION public.current_period()
RETURNS TEXT AS $$
BEGIN
  RETURN TO_CHAR(NOW(), 'YYYY-MM');
END;
$$ LANGUAGE plpgsql;

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create profile on auth.users insert
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, username, default_voucher_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'username',
      SPLIT_PART(NEW.email, '@', 1) || '_' || SUBSTRING(NEW.id::TEXT, 1, 8)
    ),
    NEW.id
  );
  RETURN NEW;
END;
$$;

-- Check if override available this month
CREATE OR REPLACE FUNCTION public.override_available(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM overrides
    WHERE user_id = p_user_id AND period = current_period()
  );
END;
$$ LANGUAGE plpgsql;

-- Enforce 5 rectify passes per month
CREATE OR REPLACE FUNCTION public.check_rectify_pass_limit()
RETURNS TRIGGER AS $$
BEGIN
    IF (
        SELECT COUNT(*)
        FROM rectify_passes
        WHERE user_id = NEW.user_id
          AND period = NEW.period
    ) >= 5 THEN
        RAISE EXCEPTION 'Rectify pass limit of 5 per month reached for user % in period %', NEW.user_id, NEW.period;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Delete subtasks when task is completed
CREATE OR REPLACE FUNCTION public.delete_subtasks_on_task_completion()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN (
      'MARKED_COMPLETE',
      'AWAITING_VOUCHER',
      'AWAITING_AI',
      'ACCEPTED',
      'AUTO_ACCEPTED',
      'AI_ACCEPTED'
    )
    AND OLD.status IS DISTINCT FROM NEW.status THEN
    DELETE FROM public.task_subtasks
    WHERE parent_task_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Enforce max 20 subtasks per task
CREATE OR REPLACE FUNCTION public.enforce_task_subtask_limit()
RETURNS TRIGGER AS $$
DECLARE
  current_count INT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.parent_task_id = OLD.parent_task_id THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)
    INTO current_count
  FROM task_subtasks
  WHERE parent_task_id = NEW.parent_task_id;

  IF current_count >= 20 THEN
    RAISE EXCEPTION 'A task cannot have more than 20 subtasks.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Prevent mutation of proof location fields
CREATE OR REPLACE FUNCTION public.prevent_task_proof_location_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.bucket IS DISTINCT FROM OLD.bucket THEN
    RAISE EXCEPTION 'bucket is immutable';
  END IF;
  IF NEW.object_path IS DISTINCT FROM OLD.object_path THEN
    RAISE EXCEPTION 'object_path is immutable';
  END IF;
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'owner_id is immutable';
  END IF;
  IF NEW.voucher_id IS DISTINCT FROM OLD.voucher_id THEN
    RAISE EXCEPTION 'voucher_id is immutable';
  END IF;
  IF NEW.task_id IS DISTINCT FROM OLD.task_id THEN
    RAISE EXCEPTION 'task_id is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Prevent task.user_id from being changed
CREATE OR REPLACE FUNCTION public.prevent_task_user_id_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.user_id <> OLD.user_id THEN
        RAISE EXCEPTION 'tasks.user_id is immutable and cannot be changed';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Increment profile lifetime XP
CREATE OR REPLACE FUNCTION public.increment_profile_lifetime_xp(p_user_id UUID, p_delta INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_user_id IS NULL OR p_delta IS NULL OR p_delta = 0 THEN
    RETURN;
  END IF;

  UPDATE public.profiles
  SET lifetime_xp = GREATEST(0, COALESCE(lifetime_xp, 0) + p_delta)
  WHERE id = p_user_id;
END;
$$;

-- Auto-assign iteration number for recurring tasks
CREATE OR REPLACE FUNCTION public.assign_recurrence_task_iteration_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.recurrence_rule_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE recurrence_rules
  SET
    latest_iteration = COALESCE(latest_iteration, 0) + 1,
    updated_at = NOW()
  WHERE id = NEW.recurrence_rule_id
  RETURNING latest_iteration INTO NEW.iteration_number;

  IF NEW.iteration_number IS NULL THEN
    RAISE EXCEPTION
      'Cannot assign iteration number: recurrence rule % not found',
      NEW.recurrence_rule_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Increment abandoned commitments count on active commitment deletion
CREATE OR REPLACE FUNCTION public.increment_abandoned_commitments_count()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'ACTIVE' THEN
    UPDATE public.profiles
    SET abandoned_commitments_count = COALESCE(abandoned_commitments_count, 0) + 1
    WHERE id = OLD.user_id;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
