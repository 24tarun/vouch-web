import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationName = "20260802173535_timestamp_aware_ai_proof_context.sql";
const webMigration = readFileSync(resolve(process.cwd(), "supabase/migrations", migrationName), "utf8");
const mobileMigration = readFileSync(resolve(process.cwd(), "../vouch-mobile/supabase/migrations", migrationName), "utf8");

test("web and mobile ship the same timestamp-aware proof migration", () => {
    assert.equal(webMigration, mobileMigration);
});

test("original deadlines remain backend audit data across postponement", () => {
    assert.match(webMigration, /ADD COLUMN IF NOT EXISTS original_deadline timestamptz/);
    assert.match(webMigration, /postponed_at IS NULL/);
    assert.match(webMigration, /NEW\.original_deadline := NEW\.deadline/);
    assert.match(webMigration, /NEW\.original_deadline := OLD\.original_deadline/);
});

test("proof metadata is optional for legacy rows and finalized by the existing RPC signature", () => {
    assert.match(webMigration, /proof_origin text NOT NULL DEFAULT 'UNKNOWN'/);
    assert.match(webMigration, /proof_timestamp_at timestamptz/);
    assert.match(webMigration, /proof_timestamp_source text NOT NULL DEFAULT 'UNKNOWN'/);
    assert.match(webMigration, /proof_timezone text/);
    assert.match(webMigration, /CREATE OR REPLACE FUNCTION public\.finalize_task_proof_atomic\([\s\S]*p_task_status text[\s\S]*RETURNS TABLE/);
});

test("shared upload function sources remain identical", () => {
    const webFunction = readFileSync(resolve(process.cwd(), "supabase/edgefunctions/task-proof-upload.ts"), "utf8");
    const mobileFunction = readFileSync(resolve(process.cwd(), "../vouch-mobile/supabase/functions/task-proof-upload/index.ts"), "utf8");
    assert.equal(webFunction, mobileFunction);
    assert.match(webFunction, /Proof timestamp does not match its visible overlay/);
});
