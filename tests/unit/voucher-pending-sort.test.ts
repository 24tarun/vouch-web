import test from "node:test";
import assert from "node:assert/strict";
import { sortPendingTasks } from "../../src/lib/voucher-pending-sort";
import type { VoucherPendingTask } from "../../src/lib/types";

function buildPendingTask(
    id: string,
    updatedAt: string,
    pendingDeadlineAt: string | null
): VoucherPendingTask {
    return {
        id,
        user_id: "owner-1",
        voucher_id: "voucher-1",
        title: `task-${id}`,
        description: null,
        failure_cost_cents: 100,
        required_pomo_minutes: null,
        deadline: "2026-03-13T18:00:00.000Z",
        status: "AWAITING_VOUCHER",
        postponed_at: null,
        marked_completed_at: "2026-03-13T10:00:00.000Z",
        voucher_response_deadline: "2026-03-15T23:59:59.999Z",
        recurrence_rule_id: null,
        google_sync_for_task: false,
        created_at: "2026-03-13T09:00:00.000Z",
        updated_at: updatedAt,
        pending_display_type: "AWAITING_VOUCHER",
        pending_deadline_at: pendingDeadlineAt,
        pending_actionable: true,
        proof_request_count: 0,
    };
}

test("pending tasks sort by updated_at descending as the primary order", () => {
    const tasks = [
        buildPendingTask("older", "2026-03-13T10:00:00.000Z", "2026-03-15T09:00:00.000Z"),
        buildPendingTask("newer", "2026-03-13T12:00:00.000Z", "2026-03-14T09:00:00.000Z"),
    ];

    const sorted = sortPendingTasks(tasks);

    /*
     * What and why this test checks:
     * This verifies the requested ordering change where recency (`updated_at`) controls the list first,
     * so newly changed pending tasks surface at the top.
     *
     * Passing scenario:
     * The task with newer updated_at is placed before the older one regardless of deadline values.
     *
     * Failing scenario:
     * If deadline still dominates ordering, recently updated tasks can be buried below older rows.
     */
    assert.deepEqual(sorted.map((task) => task.id), ["newer", "older"]);
});

test("pending_deadline_at is used as tie-breaker when updated_at is equal", () => {
    const tasks = [
        buildPendingTask("later-deadline", "2026-03-13T12:00:00.000Z", "2026-03-15T09:00:00.000Z"),
        buildPendingTask("earlier-deadline", "2026-03-13T12:00:00.000Z", "2026-03-14T09:00:00.000Z"),
        buildPendingTask("no-deadline", "2026-03-13T12:00:00.000Z", null),
    ];

    const sorted = sortPendingTasks(tasks);

    /*
     * What and why this test checks:
     * This validates the tie-break rule for equal updated_at values: earliest pending deadline first,
     * and null deadlines pushed after valid ones.
     *
     * Passing scenario:
     * Rows with equal updated_at are ordered by deadline ascending, with null deadline at the end.
     *
     * Failing scenario:
     * If tie-break logic is wrong, equal-updated rows can appear in unstable or unintuitive order.
     */
    assert.deepEqual(sorted.map((task) => task.id), [
        "earlier-deadline",
        "later-deadline",
        "no-deadline",
    ]);
});
