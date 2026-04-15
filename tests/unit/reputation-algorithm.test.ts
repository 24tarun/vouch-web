import test from "node:test";
import assert from "node:assert/strict";
import { computeFullReputationScore } from "../../src/lib/reputation/algorithm.ts";
import type { ReputationTaskInput } from "../../src/lib/reputation/types.ts";

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";

function daysAgoIso(daysAgo: number): string {
    return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

function buildTask(
    id: string,
    overrides: Partial<ReputationTaskInput> = {}
): ReputationTaskInput {
    return {
        id,
        user_id: USER_ID,
        voucher_id: USER_ID,
        status: "ACCEPTED",
        deadline: daysAgoIso(0),
        created_at: daysAgoIso(2),
        updated_at: daysAgoIso(0),
        marked_completed_at: daysAgoIso(0),
        postponed_at: null,
        recurrence_rule_id: null,
        voucher_timeout_auto_accepted: false,
        has_uploaded_proof: false,
        pomo_total_seconds: 0,
        ai_escalated_from: false,
        ...overrides,
    };
}

test("reputation includes proof quality as a direct weighted category", () => {
    const baseTasks = [
        buildTask("proof-missing-1", { voucher_id: OTHER_USER_ID, has_uploaded_proof: false }),
        buildTask("proof-missing-2", { voucher_id: OTHER_USER_ID, has_uploaded_proof: false }),
        buildTask("self-vouched-success", { voucher_id: USER_ID }),
        buildTask("self-vouched-success-2", { voucher_id: USER_ID }),
    ];
    const improvedTasks = [
        buildTask("proof-present-1", { voucher_id: OTHER_USER_ID, has_uploaded_proof: true }),
        buildTask("proof-present-2", { voucher_id: OTHER_USER_ID, has_uploaded_proof: true }),
        buildTask("self-vouched-success", { voucher_id: USER_ID }),
        buildTask("self-vouched-success-2", { voucher_id: USER_ID }),
    ];

    const baseScore = computeFullReputationScore(baseTasks, USER_ID);
    const improvedScore = computeFullReputationScore(improvedTasks, USER_ID);

    /*
     * What and why this test checks:
     * This verifies proof usage now contributes directly through the weighted score rather than only through a
     * separate compounding bonus, so adding proof to equivalent externally-vouched completions must raise RP.
     *
     * Passing scenario:
     * Two identical task sets differ only by proof attachments on externally-vouched completion attempts, and
     * the proof-rich set produces a higher reputation score with a higher proofQuality category score.
     *
     * Failing scenario:
     * If proof only affects an external bonus layer or does not count at all, both task sets collapse to the
     * same score and proofQuality no longer has direct user-visible meaning.
     */
    assert.equal(baseScore.categoryScores.proofQuality, 0);
    assert.equal(improvedScore.categoryScores.proofQuality, 1000);
    assert.ok(improvedScore.score > baseScore.score);
});

test("reputation includes recurring follow-through as discipline in the core score", () => {
    const mixedRecurring = [
        buildTask("recurring-success", { recurrence_rule_id: "rule-1", status: "ACCEPTED" }),
        buildTask("recurring-failure", { recurrence_rule_id: "rule-1", status: "MISSED", marked_completed_at: null }),
        buildTask("non-recurring-success-1"),
        buildTask("non-recurring-success-2"),
    ];
    const strongRecurring = [
        buildTask("recurring-success-1", { recurrence_rule_id: "rule-1", status: "ACCEPTED" }),
        buildTask("recurring-success-2", { recurrence_rule_id: "rule-1", status: "ACCEPTED" }),
        buildTask("non-recurring-success-1"),
        buildTask("non-recurring-success-2"),
    ];

    const mixedScore = computeFullReputationScore(mixedRecurring, USER_ID);
    const strongScore = computeFullReputationScore(strongRecurring, USER_ID);

    /*
     * What and why this test checks:
     * This verifies recurring consistency is part of the main score through the discipline category, instead of
     * being hidden behind a multiplicative task-format bonus that users cannot reason about.
     *
     * Passing scenario:
     * Keeping the same overall task volume while turning a missed recurring task into an accepted recurring task
     * raises both the discipline category score and the final reputation score.
     *
     * Failing scenario:
     * If recurring behavior only affects a side bonus or display-only metric, the reputation score does not move
     * in a stable, explainable way when recurring follow-through improves.
     */
    assert.ok(strongScore.categoryScores.discipline > mixedScore.categoryScores.discipline);
    assert.ok(strongScore.score > mixedScore.score);
});

test("community score rewards responsive voucher behavior instead of raw participation volume", () => {
    const responsiveVoucherTasks = [
        buildTask("owned-success-1"),
        buildTask("owned-success-2"),
        buildTask("voucher-reviewed-1", {
            user_id: OTHER_USER_ID,
            voucher_id: USER_ID,
            voucher_timeout_auto_accepted: false,
        }),
        buildTask("voucher-reviewed-2", {
            user_id: OTHER_USER_ID,
            voucher_id: USER_ID,
            voucher_timeout_auto_accepted: false,
        }),
    ];
    const timeoutVoucherTasks = [
        buildTask("owned-success-1"),
        buildTask("owned-success-2"),
        buildTask("voucher-timeout-1", {
            user_id: OTHER_USER_ID,
            voucher_id: USER_ID,
            voucher_timeout_auto_accepted: true,
        }),
        buildTask("voucher-timeout-2", {
            user_id: OTHER_USER_ID,
            voucher_id: USER_ID,
            voucher_timeout_auto_accepted: true,
        }),
    ];

    const responsiveScore = computeFullReputationScore(responsiveVoucherTasks, USER_ID);
    const timeoutScore = computeFullReputationScore(timeoutVoucherTasks, USER_ID);

    /*
     * What and why this test checks:
     * This verifies community is now based on voucher responsiveness quality, not on simply accumulating vouched
     * task volume that happened to finalize.
     *
     * Passing scenario:
     * A voucher who resolves finalized tasks without auto-accept timeouts receives a higher community category
     * score and higher reputation than the equivalent timeout-heavy voucher.
     *
     * Failing scenario:
     * If finalized vouched volume is still rewarded regardless of responsiveness, both task sets would score
     * similarly and community would remain easy to game through activity alone.
     */
    assert.equal(responsiveScore.categoryScores.community, 1000);
    assert.equal(timeoutScore.categoryScores.community, 0);
    assert.ok(responsiveScore.score > timeoutScore.score);
});

test("velocity compares recent finalized performance against prior finalized performance", () => {
    const fixedNowMs = Date.UTC(2026, 3, 14, 12, 0, 0, 0);
    const originalDateNow = Date.now;
    Date.now = () => fixedNowMs;

    try {
        const tasks = [
            buildTask("prior-success-1", {
                status: "ACCEPTED",
                deadline: daysAgoIso(20),
                updated_at: daysAgoIso(20),
                marked_completed_at: daysAgoIso(20),
            }),
            buildTask("prior-failure-1", {
                status: "MISSED",
                deadline: daysAgoIso(18),
                updated_at: daysAgoIso(18),
                marked_completed_at: null,
            }),
            buildTask("recent-success-1", {
                status: "ACCEPTED",
                deadline: daysAgoIso(2),
                updated_at: daysAgoIso(2),
                marked_completed_at: daysAgoIso(2),
            }),
            buildTask("recent-success-2", {
                status: "ACCEPTED",
                deadline: daysAgoIso(1),
                updated_at: daysAgoIso(1),
                marked_completed_at: daysAgoIso(1),
            }),
        ];

        const score = computeFullReputationScore(tasks, USER_ID);

        /*
         * What and why this test checks:
         * This verifies the weekly arrow now compares recent finalized performance against prior finalized
         * performance, rather than recomputing a cumulative score on a truncated dataset.
         *
         * Passing scenario:
         * A user with mixed older performance and perfect recent performance gets a positive velocity delta.
         *
         * Failing scenario:
         * If velocity still derives mostly from dataset size or cumulative-history artifacts, the delta can be
         * null or misleading even though the recent window clearly outperformed prior history.
         */
        assert.ok(score.velocityDelta !== null);
        assert.ok((score.velocityDelta ?? 0) > 0);
    } finally {
        Date.now = originalDateNow;
    }
});
