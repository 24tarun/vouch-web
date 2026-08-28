import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migration = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260827092614_remove_task_proof_command.sql"),
    "utf8"
);
const webAction = readFileSync(resolve(process.cwd(), "src/actions/tasks/proof.ts"), "utf8");
const webEdge = readFileSync(resolve(process.cwd(), "supabase/edgefunctions/task-proof-upload.ts"), "utf8");
const mobileEdge = readFileSync(
    resolve(process.cwd(), "../vouch-mobile/supabase/functions/task-proof-upload/index.ts"),
    "utf8"
);
const webProofHook = readFileSync(
    resolve(process.cwd(), "src/app/(app)/tasks/[id]/task-detail/hooks/use-task-detail-proof.ts"),
    "utf8"
);
const mobileTaskDetail = readFileSync(
    resolve(process.cwd(), "../vouch-mobile/app/(app)/tasks/[id].tsx"),
    "utf8"
);

test("proof removal is an authenticated atomic database command", () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.remove_task_proof_v2/);
    assert.match(migration, /SECURITY INVOKER/);
    assert.match(migration, /WHERE task\.id = p_task_id AND task\.user_id = v_actor[\s\S]*FOR UPDATE/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.remove_task_proof_v2\(uuid, uuid\) FROM PUBLIC, anon/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.remove_task_proof_v2\(uuid, uuid\) TO authenticated/);
});

test("proof metadata stays separate from task status", () => {
    assert.match(migration, /v_completion_undone := v_task\.status IN \('MARKED_COMPLETE', 'AWAITING_VOUCHER', 'AWAITING_AI'\)/);
    assert.match(migration, /WHEN v_completion_undone THEN 'ACTIVE'[\s\S]*ELSE v_task\.status/);
    assert.match(migration, /has_proof = false/);
    assert.match(migration, /SET upload_state = 'FAILED'/);
    assert.doesNotMatch(migration, /PROOF_UPLOADED/);
    assert.doesNotMatch(migration, /complete_task_v2/);
});

test("all proof-removal entry points use the same command", () => {
    assert.match(webAction, /runTaskCommand\(supabase, "remove_task_proof_v2"/);
    assert.match(webEdge, /userClient\.rpc\('remove_task_proof_v2'/);
    assert.match(mobileEdge, /userClient\.rpc\('remove_task_proof_v2'/);
    assert.doesNotMatch(webEdge.slice(webEdge.indexOf("if (action === 'remove-current')")), /undo_task_completion_v2/);
    assert.doesNotMatch(mobileEdge.slice(mobileEdge.indexOf("if (action === 'remove-current')")), /undo_task_completion_v2/);
});

test("auto-submit keeps proof upload and mark-complete as separate ordered operations", () => {
    const webUploadFirst = webProofHook.indexOf("await uploadAwaitingProofToBucket(taskState.id, nextDraft)");
    const webCompleteSecond = webProofHook.indexOf("await handleMarkCompleteRef.current?.(true)", webUploadFirst);
    assert.ok(webUploadFirst >= 0 && webCompleteSecond > webUploadFirst);

    const mobileUploadFirst = mobileTaskDetail.indexOf("await uploadTaskProofAsset(task.id, asset)");
    const mobileCompleteSecond = mobileTaskDetail.indexOf("type: 'complete'", mobileUploadFirst);
    assert.ok(mobileUploadFirst >= 0 && mobileCompleteSecond > mobileUploadFirst);
});
