import test from "node:test";
import assert from "node:assert/strict";
import {
    canMarkProofUploadFailed,
    isCompletionEditingLocked,
    wasProofStagedBeforeCompletionLock,
} from "../../supabase/edgefunctions/task-proof-deadline.ts";

test("proof edge policy locks replacement and removal after the inclusive minute", () => {
    const deadlineIso = "2026-07-19T12:00:00.000Z";

    for (const status of ["AWAITING_VOUCHER", "AWAITING_AI", "MARKED_COMPLETE"]) {
        assert.equal(isCompletionEditingLocked(status, deadlineIso, Date.parse("2026-07-19T12:00:59.999Z")), false);
        assert.equal(isCompletionEditingLocked(status, deadlineIso, Date.parse("2026-07-19T12:01:00.000Z")), true);
    }

    assert.equal(isCompletionEditingLocked("AWAITING_USER", deadlineIso, Date.parse("2026-07-19T12:01:00.000Z")), false);
});

test("proof failure cleanup cannot be used to remove an uploaded proof", () => {
    assert.equal(canMarkProofUploadFailed("PENDING"), true);
    assert.equal(canMarkProofUploadFailed("UPLOADED"), false);
    assert.equal(canMarkProofUploadFailed("FAILED"), false);
    assert.equal(canMarkProofUploadFailed(null), false);
});

test("finalization permits only uploads staged before the completion lock", () => {
    const deadlineIso = "2026-07-19T12:00:00.000Z";

    assert.equal(wasProofStagedBeforeCompletionLock(deadlineIso, "2026-07-19T12:00:59.999Z"), true);
    assert.equal(wasProofStagedBeforeCompletionLock(deadlineIso, "2026-07-19T12:01:00.000Z"), false);
});
