import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migration = readFileSync(
    join(root, "supabase/migrations/20260720204756_add_surrendered_task_status.sql"),
    "utf8"
);

test("surrender migration exposes a restricted atomic owner RPC", () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.surrender_task_atomic/);
    assert.match(migration, /FOR UPDATE/);
    assert.match(migration, /v_task\.created_at > v_now - interval '1 hour'/);
    assert.match(migration, /status = 'SURRENDERED'/);
    assert.match(migration, /event_type,[\s\S]*'SURRENDER'/);
    assert.match(migration, /entry_type[\s\S]*'failure'/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.surrender_task_atomic\(uuid, uuid\) FROM PUBLIC/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.surrender_task_atomic\(uuid, uuid\) TO authenticated/);
});
