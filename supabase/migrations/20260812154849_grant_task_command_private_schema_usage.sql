REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

REVOKE ALL ON FUNCTION private.preserve_task_original_deadline() FROM PUBLIC, anon, authenticated;
