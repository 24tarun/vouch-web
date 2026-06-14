ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deadline_due_warning_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.task_reminders
  DROP CONSTRAINT IF EXISTS task_reminders_source_check;

ALTER TABLE public.task_reminders
  ADD CONSTRAINT task_reminders_source_check
  CHECK (source = ANY (ARRAY[
    'MANUAL',
    'DEFAULT_DEADLINE_1H',
    'DEFAULT_DEADLINE_10M',
    'DEFAULT_DEADLINE_DUE'
  ]));

INSERT INTO public.task_reminders (
  parent_task_id,
  user_id,
  reminder_at,
  source,
  notified_at,
  created_at,
  updated_at
)
SELECT
  t.id,
  t.user_id,
  t.deadline,
  'DEFAULT_DEADLINE_DUE',
  NULL,
  NOW(),
  NOW()
FROM public.tasks t
JOIN public.profiles p ON p.id = t.user_id
WHERE p.deadline_due_warning_enabled = true
  AND t.status IN ('ACTIVE', 'POSTPONED')
  AND t.deadline > NOW()
  AND NOT EXISTS (
    SELECT 1
    FROM public.task_reminders existing
    WHERE existing.parent_task_id = t.id
      AND existing.reminder_at = t.deadline
  );
