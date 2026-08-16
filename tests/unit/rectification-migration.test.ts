import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const webMigrationPath = resolve(process.cwd(), "supabase/migrations/037_rectification_request_flow.sql");
const sql = readFileSync(webMigrationPath, "utf8");

test("the canonical web migration contains the rectification request flow", () => {
    assert.match(sql, /CREATE TABLE public\.rectification_requests/);
});

test("rectification requests reserve passes atomically and enforce one open request", () => {
    assert.match(sql, /rectification_requests_one_open_per_task[\s\S]*PENDING_HUMAN[\s\S]*PENDING_AI[\s\S]*AWAITING_AI_APPEAL/);
    assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(v_actor::text \|\| ':rectification-pass'/);
    assert.match(sql, /v_used \+ v_reserved >= 5/);
});

test("pass accounting uses the request month while reversals preserve the original failure period", () => {
    assert.match(sql, /failure_period text NOT NULL[\s\S]*request_period text NOT NULL/);
    assert.match(sql, /rectify_passes\(user_id, task_id, authorized_by, period\)[\s\S]*v_request\.request_period/);
    assert.match(sql, /ledger_entries\(user_id, task_id, period, amount_cents, entry_type\)[\s\S]*v_request\.failure_period/);
    assert.match(sql, /owner_id = v_actor AND request_period = v_request_period/);
});

test("deadline and timeout behavior keeps the 48-hour buffer without voucher penalties", () => {
    assert.match(sql, /GREATEST\(v_month_boundary, now\(\) \+ interval '48 hours'\)/);
    assert.match(sql, /process_due_rectification_requests/);
    assert.doesNotMatch(sql, /voucher_timeout_penalty/);
});

test("proof finalization recognizes awaiting rectification and service RPCs stay service-only", () => {
    assert.match(sql, /RECTIFICATION_PROOF_UPLOADED/);
    assert.match(sql, /'AWAITING_RECTIFICATION'/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.process_due_rectification_requests[\s\S]*authenticated/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.process_due_rectification_requests[\s\S]*TO service_role/);
});

test("human-targeted requests participate in friendship conflicts but AI requests do not", () => {
    assert.match(sql, /has_pending_voucher_conflict[\s\S]*target_type = 'ORIGINAL_VOUCHER'/);
});
