import test from "node:test";
import assert from "node:assert/strict";
import { AI_PROFILE_ID } from "../../src/lib/ai-voucher/constants.ts";
import {
    canFinalizeOrRevertProof,
    canInitAwaitingProofUpload,
    getAwaitingProofReviewStatus,
} from "../../src/lib/task-proof-routing.ts";

test("proof routing sends AI-vouched tasks to AWAITING_AI", () => {
    /*
     * What and why this test checks:
     * This verifies proof routing targets the correct review queue based on voucher identity.
     *
     * Passing scenario:
     * AI voucher id resolves to AWAITING_AI and a regular friend id resolves to AWAITING_VOUCHER.
     *
     * Failing scenario:
     * If AI resolves to AWAITING_VOUCHER, AI-vouched tasks go through the wrong pipeline.
     */
    assert.equal(getAwaitingProofReviewStatus(AI_PROFILE_ID), "AWAITING_AI");
    assert.equal(
        getAwaitingProofReviewStatus("11111111-1111-1111-1111-111111111111"),
        "AWAITING_VOUCHER"
    );
});

test("proof init gate allows AWAITING_USER resubmits and MARKED_COMPLETE uploads", () => {
    /*
     * What and why this test checks:
     * This confirms upload-init guard matches V2 behavior for resubmits and persisted MARKED_COMPLETE tasks.
     *
     * Passing scenario:
     * AWAITING_USER, AWAITING_AI, AWAITING_VOUCHER, and MARKED_COMPLETE return true.
     *
     * Failing scenario:
     * If AWAITING_USER or MARKED_COMPLETE is blocked, users cannot resubmit proof through the intended route.
     */
    assert.equal(canInitAwaitingProofUpload("AWAITING_USER"), true);
    assert.equal(canInitAwaitingProofUpload("AWAITING_AI"), true);
    assert.equal(canInitAwaitingProofUpload("AWAITING_VOUCHER"), true);
    assert.equal(canInitAwaitingProofUpload("MARKED_COMPLETE"), true);
    assert.equal(canInitAwaitingProofUpload("ACTIVE"), false);
});

test("proof finalize/revert gate supports AI and persisted MARKED_COMPLETE states", () => {
    /*
     * What and why this test checks:
     * This validates finalize/revert operations are allowed for AI queue and persisted MARKED_COMPLETE.
     *
     * Passing scenario:
     * AWAITING_AI, AWAITING_VOUCHER, and MARKED_COMPLETE return true, while AWAITING_USER returns false.
     *
     * Failing scenario:
     * If AWAITING_AI is excluded, AI proof finalization and revert flows cannot complete.
     */
    assert.equal(canFinalizeOrRevertProof("AWAITING_AI"), true);
    assert.equal(canFinalizeOrRevertProof("AWAITING_VOUCHER"), true);
    assert.equal(canFinalizeOrRevertProof("MARKED_COMPLETE"), true);
    assert.equal(canFinalizeOrRevertProof("AWAITING_USER"), false);
});
