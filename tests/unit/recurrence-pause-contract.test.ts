import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const migration = readFileSync(
    join(root, "supabase/migrations/034_pause_resume_recurrence.sql"),
    "utf8"
);
const generator = readFileSync(join(root, "src/trigger/recurrence-generator.ts"), "utf8");

test("pause migration preserves recurrence rules and exposes an authenticated idempotent RPC", () => {
    assert.match(migration, /ADD COLUMN IF NOT EXISTS paused_at timestamptz/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.set_recurrence_paused/);
    assert.match(migration, /p_paused = \(v_existing_paused_at IS NOT NULL\)/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.set_recurrence_paused\(uuid, boolean, uuid\) FROM anon/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.set_recurrence_paused\(uuid, boolean, uuid\) TO authenticated/);
    assert.match(migration, /jsonb_build_object\('recurrence_rule_id', v_rule_id\)/);
});

test("resume skips its local calendar date and paused rules cannot advance iterations", () => {
    assert.match(migration, /last_generated_date = \(now\(\) AT TIME ZONE/);
    assert.match(migration, /AND paused_at IS NULL[\s\S]*RETURNING latest_iteration INTO NEW\.iteration_number/);
    assert.match(migration, /Cannot create recurring task: recurrence rule % is paused/);
});

test("the recurrence generator excludes paused rules", () => {
    assert.match(generator, /\.is\("paused_at", null\)/);
    assert.match(generator, /if \(rule\.paused_at\) return/);
});
