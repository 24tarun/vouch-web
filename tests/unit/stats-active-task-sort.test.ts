import test from "node:test";
import assert from "node:assert/strict";
import { sortStatsActiveTasks } from "../../src/lib/stats-active-task-sort.ts";
import type { Task } from "../../src/lib/types.ts";

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

function buildTask(
    id: string,
    overrides: Partial<Task> = {}
): Task {
    return {
        id,
        user_id: "user-1",
        voucher_id: "user-1",
        title: `task-${id}`,
        description: null,
        failure_cost_cents: 100,
        required_pomo_minutes: null,
        deadline: toLocalIso(2026, 2, 8, 18, 0),
        status: "ACTIVE",
        postponed_at: null,
        marked_completed_at: null,
        voucher_response_deadline: null,
        recurrence_rule_id: null,
        google_sync_for_task: false,
        created_at: toLocalIso(2026, 2, 1, 9, 0),
        updated_at: toLocalIso(2026, 2, 1, 9, 0),
        ...overrides,
    };
}

test("stats active tasks sort by recent completion action first", () => {
    const tasks = [
        buildTask("older-complete", {
            status: "AWAITING_VOUCHER",
            marked_completed_at: toLocalIso(2026, 2, 5, 10, 0),
            updated_at: toLocalIso(2026, 2, 6, 8, 0),
        }),
        buildTask("recent-complete", {
            status: "MARKED_COMPLETE",
            marked_completed_at: toLocalIso(2026, 2, 6, 12, 0),
            updated_at: toLocalIso(2026, 2, 6, 12, 30),
        }),
        buildTask("plain-active", {
            status: "ACTIVE",
            updated_at: toLocalIso(2026, 2, 7, 9, 0),
        }),
    ];

    const sorted = sortStatsActiveTasks(tasks);

    /*
     * What and why this test checks:
     * This verifies the stats-page sort uses the latest action timestamp overall, while still using the
     * completion action timestamp to order voucher-pending tasks that have been marked complete.
     *
     * Passing scenario:
     * The plain active task updated on Mar 7, 2026 appears first as the newest overall action, and among the
     * completion-pending tasks the item marked completed later on Mar 6, 2026 appears before the older one.
     *
     * Failing scenario:
     * If the page still sorts by deadline, or if voucher-pending tasks ignore marked_completed_at, the active
     * list no longer reflects the latest action and recently completed items can appear in the wrong order.
     */
    assert.deepEqual(
        sorted.map((task) => task.id),
        ["plain-active", "recent-complete", "older-complete"]
    );
});

test("stats active tasks use the newest timestamp across updated and marked complete", () => {
    const tasks = [
        buildTask("newer-marked", {
            status: "AWAITING_VOUCHER",
            marked_completed_at: toLocalIso(2026, 2, 7, 12, 0),
            updated_at: toLocalIso(2026, 2, 7, 10, 0),
        }),
        buildTask("newer-updated", {
            status: "MARKED_COMPLETE",
            marked_completed_at: toLocalIso(2026, 2, 7, 9, 0),
            updated_at: toLocalIso(2026, 2, 7, 13, 0),
        }),
    ];

    const sorted = sortStatsActiveTasks(tasks);

    /*
     * What and why this test checks:
     * This verifies the stats-page sort compares both updated_at and marked_completed_at and uses whichever
     * timestamp is newer for each task, because the user wants the most recently changed task on top.
     *
     * Passing scenario:
     * A task with the newest updated_at on Mar 7, 2026 sorts above a different task whose newest timestamp is
     * its marked_completed_at, even though that completion timestamp is also recent.
     *
     * Failing scenario:
     * If the code always prioritizes marked_completed_at over updated_at, or vice versa, the list can show an
     * older change first and the stats page no longer reflects the latest task change correctly.
     */
    assert.deepEqual(
        sorted.map((task) => task.id),
        ["newer-updated", "newer-marked"]
    );
});

test("stats active tasks fall back to recent updated_at when no completion timestamp exists", () => {
    const tasks = [
        buildTask("older-update", {
            updated_at: toLocalIso(2026, 2, 6, 9, 0),
        }),
        buildTask("newer-update", {
            updated_at: toLocalIso(2026, 2, 7, 11, 0),
        }),
    ];

    const sorted = sortStatsActiveTasks(tasks);

    /*
     * What and why this test checks:
     * This verifies normal active tasks still sort by their latest non-completion activity when they have
     * never been marked complete, which covers created or postponed tasks on the stats page.
     *
     * Passing scenario:
     * The task updated on Mar 7, 2026 appears before the task updated on Mar 6, 2026.
     *
     * Failing scenario:
     * If these tasks stay in deadline order, newer active work is buried below older items even though the
     * user asked for the most recent action to be shown first.
     */
    assert.deepEqual(
        sorted.map((task) => task.id),
        ["newer-update", "older-update"]
    );
});

test("stats active tasks use deadline as a stable tie-breaker for equal action timestamps", () => {
    const sharedUpdatedAt = toLocalIso(2026, 2, 7, 11, 0);
    const tasks = [
        buildTask("later-deadline", {
            updated_at: sharedUpdatedAt,
            deadline: toLocalIso(2026, 2, 9, 18, 0),
        }),
        buildTask("earlier-deadline", {
            updated_at: sharedUpdatedAt,
            deadline: toLocalIso(2026, 2, 8, 18, 0),
        }),
    ];

    const sorted = sortStatsActiveTasks(tasks);

    /*
     * What and why this test checks:
     * This verifies equal-action rows still render in a deterministic order by deadline, which avoids
     * unstable list jumps when two active tasks were touched at the same time.
     *
     * Passing scenario:
     * When both tasks share the same action timestamp, the earlier deadline stays on top.
     *
     * Failing scenario:
     * If ties are left unresolved or use a random order, the list can flicker between refreshes and becomes
     * harder to scan consistently.
     */
    assert.deepEqual(
        sorted.map((task) => task.id),
        ["earlier-deadline", "later-deadline"]
    );
});
