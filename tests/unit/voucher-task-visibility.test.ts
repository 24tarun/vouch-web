import test from "node:test";
import assert from "node:assert/strict";
import { isTaskScheduledForTodayOrTomorrow } from "../../src/lib/dashboard-task-buckets.ts";
import { canVoucherSeeTask } from "../../src/lib/voucher-task-visibility.ts";
import type { Task } from "../../src/lib/types.ts";

function buildReferenceNow(): Date {
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

function buildTask(
    id: string,
    overrides: Partial<Task> = {}
): Task {
    return {
        id,
        user_id: "user-1",
        voucher_id: "voucher-1",
        title: `task-${id}`,
        description: null,
        failure_cost_cents: 100,
        required_pomo_minutes: null,
        deadline: toLocalIso(2026, 5, 1, 18, 0),
        status: "ACTIVE",
        postponed_at: null,
        marked_completed_at: null,
        voucher_response_deadline: null,
        recurrence_rule_id: null,
        google_sync_for_task: false,
        created_at: toLocalIso(2026, 5, 1, 9, 0),
        updated_at: toLocalIso(2026, 5, 1, 9, 0),
        ...overrides,
    };
}

test("voucher active-task window includes only today and tomorrow", () => {
    const reference = buildReferenceNow();

    /*
     * What and why this test checks:
     * This verifies the shared voucher visibility window is limited to tasks scheduled for the local
     * current day or the next day, which is the new product rule for exposed active tasks.
     *
     * Passing scenario:
     * A task due on Jun 1, 2026 or Jun 2, 2026 is included, while a task due on Jun 3, 2026 is excluded.
     *
     * Failing scenario:
     * If the future task is treated as visible, vouchers can still see active work beyond tomorrow and the
     * visibility restriction is not actually enforced.
     */
    assert.equal(
        isTaskScheduledForTodayOrTomorrow(buildTask("today", { deadline: toLocalIso(2026, 5, 1, 18, 0) }), reference),
        true
    );
    assert.equal(
        isTaskScheduledForTodayOrTomorrow(buildTask("tomorrow", { deadline: toLocalIso(2026, 5, 2, 18, 0) }), reference),
        true
    );
    assert.equal(
        isTaskScheduledForTodayOrTomorrow(buildTask("future", { deadline: toLocalIso(2026, 5, 3, 9, 0) }), reference),
        false
    );
});

test("voucher active-task visibility excludes overdue and hidden-owner tasks", () => {
    const reference = buildReferenceNow();

    /*
     * What and why this test checks:
     * This verifies active-task visibility requires both owner opt-in and a deadline inside the today/tomorrow
     * window, so overdue tasks and non-shared active tasks stay hidden from the voucher.
     *
     * Passing scenario:
     * An overdue active task is hidden even when the owner enabled sharing, and a today task is hidden when
     * the owner disabled sharing.
     *
     * Failing scenario:
     * If either task becomes visible, vouchers can still see active items that should be excluded by the new
     * schedule window or the owner's privacy toggle.
     */
    assert.equal(
        canVoucherSeeTask(
            {
                ...buildTask("overdue", {
                    deadline: toLocalIso(2026, 4, 31, 20, 0),
                }),
                user: { voucher_can_view_active_tasks: true },
            },
            reference
        ),
        false
    );
    assert.equal(
        canVoucherSeeTask(
            {
                ...buildTask("hidden", {
                    deadline: toLocalIso(2026, 5, 1, 20, 0),
                }),
                user: { voucher_can_view_active_tasks: false },
            },
            reference
        ),
        false
    );
});

test("voucher still sees awaiting-voucher tasks regardless of the active-task window", () => {
    const reference = buildReferenceNow();

    /*
     * What and why this test checks:
     * This verifies the new date window applies only to active tasks, not to items already awaiting voucher
     * action, because those still need a response even if their original deadline is older or farther out.
     *
     * Passing scenario:
     * A task in AWAITING_VOUCHER remains visible even when its deadline sits outside the today/tomorrow window
     * and the owner's active-task sharing flag is disabled.
     *
     * Failing scenario:
     * If this task is hidden, vouchers can miss approval work that is still pending and actionable.
     */
    assert.equal(
        canVoucherSeeTask(
            {
                ...buildTask("awaiting", {
                    status: "AWAITING_VOUCHER",
                    deadline: toLocalIso(2026, 5, 4, 12, 0),
                }),
                user: { voucher_can_view_active_tasks: false },
            },
            reference
        ),
        true
    );
});
