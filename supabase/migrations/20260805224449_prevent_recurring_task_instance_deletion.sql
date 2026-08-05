-- Recurring task instances are controlled by their recurrence rule. They must
-- not be hard-deleted by a client during the ordinary task deletion grace
-- period; users can pause or stop the series instead.
DROP POLICY IF EXISTS "Users can delete own tasks" ON public.tasks;

CREATE POLICY "Users can delete own non-recurring tasks"
  ON public.tasks FOR DELETE
  TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND recurrence_rule_id IS NULL
  );
