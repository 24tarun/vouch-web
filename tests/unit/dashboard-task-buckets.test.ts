import test from "node:test";
import assert from "node:assert/strict";
import { splitDashboardActiveTaskBuckets } from "../../src/lib/dashboard-task-buckets.ts";
import type { Task } from "../../src/lib/types.ts";

function buildReferenceNow(): Date {
    // Fixed local timestamp keeps local-day boundary assertions deterministic.
    return new Date(2026, 5, 1, 10, 0, 0, 0); // Jun 1, 2026 10:00 local
}

function toLocalIso(
    year: number,
    monthIndex: number,
    day: number,
    hours: number,
    minutes: number,
    seconds = 0,
    milliseconds = 0
): string {
    return new Date(year, monthIndex, day, hours, minutes, seconds, milliseconds).toISOString();
}

function buildActiveTask(id: string, deadlineIso: string): Task {
    return {
        id,
        user_id: "user-1",
        voucher_id: "user-1",
        title: `task-${id}`,
        description: null,
        failure_cost_cents: 100,
        required_pomo_minutes: null,
        deadline: deadlineIso,
        status: "ACTIVE",
        postponed_at: null,
        marked_completed_at: null,
        voucher_response_deadline: null,
        recurrence_rule_id: null,
        google_sync_for_task: false,
        created_at: toLocalIso(2026, 5, 1, 9, 0, 0, 0),
        updated_at: toLocalIso(2026, 5, 1, 9, 0, 0, 0),
    };
}

test("due today task stays in Active bucket", () => {
    /*
     * What and why this test checks:
     * This verifies the core bucket rule that active tasks due on the current local day
     * remain in the non-collapsible Active section.
     *
     * Passing scenario:
     * A task due on Jun 1, 2026 is included in activeDueSoonTasks and excluded from futureTasks.
     *
     * Failing scenario:
     * If this task appears in futureTasks, users would not see a today-deadline task in Active.
     */
    const task = buildActiveTask("today", toLocalIso(2026, 5, 1, 23, 45));
    const split = splitDashboardActiveTaskBuckets([task], buildReferenceNow());

    assert.equal(split.activeDueSoonTasks.length, 1);
    assert.equal(split.futureTasks.length, 0);
    assert.equal(split.activeDueSoonTasks[0]?.id, "today");
});

test("due tomorrow task stays in Active bucket", () => {
    /*
     * What and why this test checks:
     * This validates the inclusive-through-tomorrow requirement for Active tasks.
     *
     * Passing scenario:
     * A task due on Jun 2, 2026 is still grouped in activeDueSoonTasks.
     *
     * Failing scenario:
     * If tomorrow tasks move to Future, Active would violate the agreed product rule.
     */
    const task = buildActiveTask("tomorrow", toLocalIso(2026, 5, 2, 12, 0));
    const split = splitDashboardActiveTaskBuckets([task], buildReferenceNow());

    assert.equal(split.activeDueSoonTasks.length, 1);
    assert.equal(split.futureTasks.length, 0);
    assert.equal(split.activeDueSoonTasks[0]?.id, "tomorrow");
});

test("due day-after-tomorrow task goes to Future bucket", () => {
    /*
     * What and why this test checks:
     * This confirms the Future boundary starts at local midnight of day-after-tomorrow.
     *
     * Passing scenario:
     * A task exactly at Jun 3, 2026 00:00 local is grouped under futureTasks.
     *
     * Failing scenario:
     * If this task stays in Active, the day boundary is off and Future misses intended items.
     */
    const task = buildActiveTask("future", toLocalIso(2026, 5, 3, 0, 0, 0, 0));
    const split = splitDashboardActiveTaskBuckets([task], buildReferenceNow());

    assert.equal(split.activeDueSoonTasks.length, 0);
    assert.equal(split.futureTasks.length, 1);
    assert.equal(split.futureTasks[0]?.id, "future");
});

test("overdue active task stays visible in Active fallback", () => {
    /*
     * What and why this test checks:
     * This protects the overdue fallback behavior so urgent active tasks are not hidden.
     *
     * Passing scenario:
     * A task due before today remains in activeDueSoonTasks.
     *
     * Failing scenario:
     * If overdue tasks are moved out of Active, users lose visibility of urgent pending work.
     */
    const task = buildActiveTask("overdue", toLocalIso(2026, 4, 31, 20, 0));
    const split = splitDashboardActiveTaskBuckets([task], buildReferenceNow());

    assert.equal(split.activeDueSoonTasks.length, 1);
    assert.equal(split.futureTasks.length, 0);
    assert.equal(split.activeDueSoonTasks[0]?.id, "overdue");
});

test("invalid deadline string stays visible in Active fallback", () => {
    /*
     * What and why this test checks:
     * This ensures malformed deadline data does not disappear from the dashboard.
     *
     * Passing scenario:
     * A task with invalid deadline is kept in activeDueSoonTasks.
     *
     * Failing scenario:
     * If invalid-deadline tasks are dropped or moved to Future, the user cannot recover/edit them.
     */
    const task = buildActiveTask("invalid", "not-a-date");
    const split = splitDashboardActiveTaskBuckets([task], buildReferenceNow());

    assert.equal(split.activeDueSoonTasks.length, 1);
    assert.equal(split.futureTasks.length, 0);
    assert.equal(split.activeDueSoonTasks[0]?.id, "invalid");
});

test("local boundary keeps tomorrow 23:59:59.999 in Active and next midnight in Future", () => {
    /*
     * What and why this test checks:
     * This verifies the exact local-time split at the midnight boundary to prevent off-by-one regressions.
     *
     * Passing scenario:
     * Jun 2, 2026 23:59:59.999 local is Active, while Jun 3, 2026 00:00:00.000 local is Future.
     *
     * Failing scenario:
     * If either side is misclassified, users see boundary tasks in the wrong accordion.
     */
    const activeBoundaryTask = buildActiveTask("active-boundary", toLocalIso(2026, 5, 2, 23, 59, 59, 999));
    const futureBoundaryTask = buildActiveTask("future-boundary", toLocalIso(2026, 5, 3, 0, 0, 0, 0));
    const split = splitDashboardActiveTaskBuckets([activeBoundaryTask, futureBoundaryTask], buildReferenceNow());

    assert.deepEqual(
        split.activeDueSoonTasks.map((task) => task.id),
        ["active-boundary"]
    );
    assert.deepEqual(
        split.futureTasks.map((task) => task.id),
        ["future-boundary"]
    );
});
