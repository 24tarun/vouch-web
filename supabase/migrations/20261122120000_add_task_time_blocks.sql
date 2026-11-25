
CREATE TABLE public.task_time_blocks (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL,
  task_id             uuid,
  recurrence_rule_id  uuid,
  occurrence_deadline timestamptz,
  start_at            timestamptz NOT NULL,
  end_at              timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_time_blocks_pkey PRIMARY KEY (id),
  CONSTRAINT task_time_blocks_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT task_time_blocks_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES public.tasks (id) ON DELETE CASCADE,
  CONSTRAINT task_time_blocks_recurrence_rule_id_fkey
    FOREIGN KEY (recurrence_rule_id) REFERENCES public.recurrence_rules (id) ON DELETE CASCADE,
  CONSTRAINT task_time_blocks_target_check CHECK (
    (task_id IS NOT NULL AND recurrence_rule_id IS NULL AND occurrence_deadline IS NULL)
    OR (task_id IS NULL AND recurrence_rule_id IS NOT NULL AND occurrence_deadline IS NOT NULL)
  ),
  CONSTRAINT task_time_blocks_range_check CHECK (end_at > start_at),
  CONSTRAINT task_time_blocks_max_length_check CHECK (end_at - start_at <= interval '24 hours'),
  CONSTRAINT task_time_blocks_quarter_hour_check CHECK (
    (extract(epoch FROM start_at)::bigint % 900) = 0
    AND (extract(epoch FROM end_at)::bigint % 900) = 0
  )
);

CREATE INDEX task_time_blocks_user_start_idx ON public.task_time_blocks (user_id, start_at);
CREATE INDEX task_time_blocks_task_idx ON public.task_time_blocks (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX task_time_blocks_ghost_idx ON public.task_time_blocks (recurrence_rule_id, occurrence_deadline)
  WHERE recurrence_rule_id IS NOT NULL;

ALTER TABLE public.task_time_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY task_time_blocks_select_own ON public.task_time_blocks
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY task_time_blocks_insert_own ON public.task_time_blocks
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY task_time_blocks_update_own ON public.task_time_blocks
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY task_time_blocks_delete_own ON public.task_time_blocks
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION private.validate_task_time_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_task record;
  v_rule record;
  v_times_changed boolean;
BEGIN
  NEW.updated_at := now();

  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id <> OLD.user_id THEN
      RAISE EXCEPTION 'Time block owner cannot change.';
    END IF;
    IF NEW.task_id IS DISTINCT FROM OLD.task_id
       OR NEW.recurrence_rule_id IS DISTINCT FROM OLD.recurrence_rule_id
       OR NEW.occurrence_deadline IS DISTINCT FROM OLD.occurrence_deadline THEN
      IF NOT (
        OLD.task_id IS NULL AND NEW.task_id IS NOT NULL AND NEW.recurrence_rule_id IS NULL
        AND EXISTS (
          SELECT 1 FROM public.tasks AS task
          WHERE task.id = NEW.task_id
            AND task.recurrence_rule_id = OLD.recurrence_rule_id
            AND task.deadline = OLD.occurrence_deadline
        )
      ) THEN
        RAISE EXCEPTION 'Time block cannot be moved to another task.';
      END IF;
      RETURN NEW;
    END IF;
  END IF;

  v_times_changed := TG_OP = 'INSERT'
    OR NEW.start_at IS DISTINCT FROM OLD.start_at
    OR NEW.end_at IS DISTINCT FROM OLD.end_at;

  IF NEW.task_id IS NOT NULL THEN
    SELECT task.user_id, task.status, task.deadline, task.google_sync_for_task, task.is_strict
      INTO v_task
      FROM public.tasks AS task WHERE task.id = NEW.task_id;
    IF NOT FOUND OR v_task.user_id <> NEW.user_id THEN
      RAISE EXCEPTION 'Task not found.';
    END IF;
    IF v_times_changed THEN
      IF v_task.status NOT IN ('ACTIVE', 'POSTPONED') THEN
        RAISE EXCEPTION 'Blocks can only be planned for active tasks.';
      END IF;
      IF v_task.google_sync_for_task OR v_task.is_strict THEN
        RAISE EXCEPTION 'Events cannot have time blocks.';
      END IF;
      IF NEW.end_at > v_task.deadline THEN
        RAISE EXCEPTION 'A block cannot end after the task deadline.';
      END IF;
    END IF;
  ELSE
    SELECT rule.user_id, rule.paused_at, rule.google_sync_for_rule, rule.time_bound_for_rule
      INTO v_rule
      FROM public.recurrence_rules AS rule WHERE rule.id = NEW.recurrence_rule_id;
    IF NOT FOUND OR v_rule.user_id <> NEW.user_id THEN
      RAISE EXCEPTION 'Repeating task not found.';
    END IF;
    IF v_times_changed THEN
      IF v_rule.paused_at IS NOT NULL THEN
        RAISE EXCEPTION 'Paused repeating tasks cannot have time blocks.';
      END IF;
      IF v_rule.google_sync_for_rule OR COALESCE(v_rule.time_bound_for_rule, false) THEN
        RAISE EXCEPTION 'Events cannot have time blocks.';
      END IF;
      IF NEW.end_at > NEW.occurrence_deadline THEN
        RAISE EXCEPTION 'A block cannot end after the task deadline.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER task_time_blocks_validate
  BEFORE INSERT OR UPDATE ON public.task_time_blocks
  FOR EACH ROW EXECUTE FUNCTION private.validate_task_time_block();

CREATE OR REPLACE FUNCTION private.cleanup_task_time_blocks_on_task_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'DELETED' AND OLD.status IS DISTINCT FROM 'DELETED' THEN
    DELETE FROM public.task_time_blocks AS block WHERE block.task_id = NEW.id;
  ELSIF NEW.deadline < OLD.deadline THEN
    DELETE FROM public.task_time_blocks AS block
    WHERE block.task_id = NEW.id AND block.end_at > NEW.deadline;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_cleanup_time_blocks
  AFTER UPDATE OF status, deadline ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION private.cleanup_task_time_blocks_on_task_update();

CREATE OR REPLACE FUNCTION private.attach_ghost_time_blocks_on_task_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.recurrence_rule_id IS NULL THEN
    RETURN NEW;
  END IF;
  BEGIN
    UPDATE public.task_time_blocks AS block
    SET task_id = NEW.id, recurrence_rule_id = NULL, occurrence_deadline = NULL
    WHERE block.recurrence_rule_id = NEW.recurrence_rule_id
      AND block.occurrence_deadline = NEW.deadline
      AND block.user_id = NEW.user_id;
  EXCEPTION WHEN others THEN
    DELETE FROM public.task_time_blocks AS block
    WHERE block.recurrence_rule_id = NEW.recurrence_rule_id
      AND block.occurrence_deadline = NEW.deadline;
  END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_attach_ghost_time_blocks
  AFTER INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION private.attach_ghost_time_blocks_on_task_insert();

REVOKE ALL ON FUNCTION private.validate_task_time_block() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cleanup_task_time_blocks_on_task_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.attach_ghost_time_blocks_on_task_insert() FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_time_blocks TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.task_time_blocks;
