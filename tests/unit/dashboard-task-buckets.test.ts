import test from "node:test";
import assert from "node:assert/strict";
import { splitDashboardActiveTaskBuckets } from "../../src/lib/dashboard-task-buckets.ts";
import type { Task } from "../../src/lib/types.ts";

function buildReferenceNow(): Date {
    return new Date(2026, 5, 1, 10, 0, 0, 0);
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
    const task = buildActiveTask("today", toLocalIso(2026, 5, 1, 23, 45));
    const split = splitDashboardActiveTaskBuckets([task], buildReferenceNow());

    assert.equal(split.activeDueSoonTasks.length, 1);
    assert.equal(split.futureTasks.length, 0);
    assert.equal(split.activeDueSoonTasks[0]?.id, "today");
});

test("due tomorrow task stays in Active bucket", () => {
    const task = buildActiveTask("tomorrow", toLocalIso(2026, 5, 2, 12, 0));
    const split = splitDashboardActiveTaskBuckets([task], buildReferenceNow());

    assert.equal(split.activeDueSoonTasks.length, 1);
    assert.equal(split.futureTasks.length, 0);
    assert.equal(split.activeDueSoonTasks[0]?.id, "tomorrow");
});

test("due day-after-tomorrow task goes to Future bucket", () => {
    const task = buildActiveTask("future", toLocalIso(2026, 5, 3, 0, 0, 0, 0));
    const split = splitDashboardActiveTaskBuckets([task], buildReferenceNow());

    assert.equal(split.activeDueSoonTasks.length, 0);
    assert.equal(split.futureTasks.length, 1);
    assert.equal(split.futureTasks[0]?.id, "future");
});

test("overdue active task stays visible in Active fallback", () => {
    const task = buildActiveTask("overdue", toLocalIso(2026, 4, 31, 20, 0));
    const split = splitDashboardActiveTaskBuckets([task], buildReferenceNow());

    assert.equal(split.activeDueSoonTasks.length, 1);
    assert.equal(split.futureTasks.length, 0);
    assert.equal(split.activeDueSoonTasks[0]?.id, "overdue");
});

test("invalid deadline string stays visible in Active fallback", () => {
    const task = buildActiveTask("invalid", "not-a-date");
    const split = splitDashboardActiveTaskBuckets([task], buildReferenceNow());

    assert.equal(split.activeDueSoonTasks.length, 1);
    assert.equal(split.futureTasks.length, 0);
    assert.equal(split.activeDueSoonTasks[0]?.id, "invalid");
});

test("local boundary keeps tomorrow 23:59:59.999 in Active and next midnight in Future", () => {
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
