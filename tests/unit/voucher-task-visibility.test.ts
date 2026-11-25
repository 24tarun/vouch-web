import test from "node:test";
import assert from "node:assert/strict";
import { isTaskScheduledForTodayOrTomorrow } from "../../src/lib/dashboard-task-buckets.ts";
import { canVoucherSeeTask } from "../../src/lib/voucher-task-visibility.ts";
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

test("voucher sees opted-in active tasks due tomorrow", () => {
    const reference = buildReferenceNow();

    assert.equal(
        canVoucherSeeTask(
            {
                ...buildTask("tomorrow-active", {
                    deadline: toLocalIso(2026, 5, 2, 18, 0),
                }),
                user: { voucher_can_view_active_tasks: true },
            },
            reference
        ),
        true
    );
});

test("voucher still sees awaiting-voucher tasks regardless of the active-task window", () => {
    const reference = buildReferenceNow();

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
