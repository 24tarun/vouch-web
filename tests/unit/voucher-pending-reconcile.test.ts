import test from "node:test";
import assert from "node:assert/strict";
import { reconcilePendingTasksFromServer } from "../../src/lib/voucher-pending-reconcile";

function buildPendingTask(id: string, title: string) {
    return {
        id,
        title,
    };
}

test("stale server payload keeps an optimistically removed pending task hidden", () => {
    const staleServerTasks = [
        buildPendingTask("task-a", "Write summary"),
        buildPendingTask("task-b", "Ship fix"),
    ];

    const reconciled = reconcilePendingTasksFromServer(
        staleServerTasks,
        new Set(["task-a"])
    );

    assert.deepEqual(
        reconciled.pendingTasks.map((task) => task.id),
        ["task-b"]
    );
    assert.deepEqual(
        Array.from(reconciled.suppressedPendingTaskIds),
        ["task-a"]
    );
});

test("fresh server payload clears suppression once the resolved task disappears upstream", () => {
    const freshServerTasks = [buildPendingTask("task-b", "Ship fix")];

    const reconciled = reconcilePendingTasksFromServer(
        freshServerTasks,
        new Set(["task-a"])
    );

    assert.deepEqual(
        reconciled.pendingTasks.map((task) => task.id),
        ["task-b"]
    );
    assert.equal(reconciled.suppressedPendingTaskIds.size, 0);
});
