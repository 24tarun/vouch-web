import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const migration = readFileSync(
    join(root, "supabase/migrations/20260725200254_update_paused_recurrence_settings.sql"),
    "utf8"
);
const generator = readFileSync(join(root, "src/trigger/recurrence-generator.ts"), "utf8");
const taskAction = readFileSync(join(root, "src/actions/tasks/recurrence.ts"), "utf8");

test("paused recurrence settings update keeps the existing rule and requires a paused lock", () => {
    assert.match(migration, /FUNCTION public\.update_paused_recurrence_settings/);
    assert.match(migration, /FOR UPDATE OF rr/);
    assert.match(migration, /IF v_paused_at IS NULL/);
    assert.match(migration, /Pause repetitions before editing future settings/);
    assert.match(migration, /UPDATE public\.recurrence_rules/);
    assert.doesNotMatch(migration, /DELETE FROM public\.recurrence_rules/);
    assert.doesNotMatch(migration, /INSERT INTO public\.recurrence_rules/);
});

test("paused recurrence settings validate time, cost, voucher, and AI proof", () => {
    assert.match(migration, /p_time_of_day !~ '\^\(\?:\[01\]\[0-9\]\|2\[0-3\]\):\[0-5\]\[0-9\]\$'/);
    assert.match(migration, /v_currency = 'INR'/);
    assert.match(migration, /FROM public\.friendships f/);
    assert.match(migration, /11111111-1111-1111-1111-111111111111/);
    assert.match(migration, /v_next_requires_proof := true/);
});

test("only authenticated callers receive the recurrence-settings RPC", () => {
    assert.match(migration, /SECURITY INVOKER/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.update_paused_recurrence_settings[\s\S]*FROM PUBLIC/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.update_paused_recurrence_settings[\s\S]*FROM anon/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.update_paused_recurrence_settings[\s\S]*TO authenticated/);
});

test("future generated tasks consume the edited rule fields without changing streak identity", () => {
    assert.match(generator, /failure_cost_cents: rule\.failure_cost_cents/);
    assert.match(generator, /voucher_id: rule\.voucher_id/);
    assert.match(generator, /requires_proof: Boolean\(rule\.requires_proof\)/);
    assert.match(generator, /recurrence_rule_id: rule\.id/);
    assert.match(generator, /time_of_day/);
    assert.match(taskAction, /p_time_of_day: patch\.timeOfDay \?\? null/);
    assert.match(taskAction, /p_failure_cost_cents: patch\.failureCostCents \?\? null/);
    assert.match(taskAction, /p_voucher_id: patch\.voucherId \?\? null/);
    assert.match(taskAction, /p_requires_proof: patch\.requiresProof \?\? null/);
});
