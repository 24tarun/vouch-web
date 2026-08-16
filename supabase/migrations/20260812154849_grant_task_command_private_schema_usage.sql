-- The public task commands call narrowly granted helpers in the private
-- schema. EXECUTE alone is insufficient: callers also need schema USAGE to
-- resolve those helper names. The private schema is not exposed through the
-- Data API, and individual helper EXECUTE grants remain restricted.
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

-- This trigger helper never needs to be invoked directly by an API role.
REVOKE ALL ON FUNCTION private.preserve_task_original_deadline() FROM PUBLIC, anon, authenticated;
