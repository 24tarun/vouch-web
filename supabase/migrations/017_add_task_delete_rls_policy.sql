-- Allow users to hard-delete their own tasks.
-- Time-window enforcement (10-minute window) is handled in the app layer.
CREATE POLICY "Users can delete own tasks"
  ON public.tasks FOR DELETE
  USING (auth.uid() = user_id);
