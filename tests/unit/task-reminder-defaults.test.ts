import test from "node:test";
import assert from "node:assert/strict";
import {
    buildDefaultDeadlineReminderRows,
    DEFAULT_DEADLINE_DUE_REMINDER_SOURCE,
} from "../../src/lib/task-reminder-defaults.ts";
import { normalizeUrgentRemindersFromFormData } from "../../src/actions/tasks/helpers.ts";

const baseInput = {
    parentTaskId: "task-1",
    userId: "user-1",
    deadline: new Date("2026-03-23T10:00:00.000Z"),
    deadlineOneHourWarningEnabled: true,
    deadlineFinalWarningEnabled: true,
    now: new Date("2026-03-23T08:30:00.000Z"),
};

test("default deadline reminders include the due-time final call when enabled", () => {
    const rows = buildDefaultDeadlineReminderRows({
        ...baseInput,
        deadlineDueWarningEnabled: true,
    });

    const dueReminder = rows.find((row) => row.source === DEFAULT_DEADLINE_DUE_REMINDER_SOURCE);

    assert.ok(dueReminder);
    assert.equal(dueReminder.reminder_at, "2026-03-23T10:00:00.000Z");
    assert.equal(dueReminder.notified_at, null);
});

test("default deadline reminders skip the due-time final call when disabled", () => {
    const rows = buildDefaultDeadlineReminderRows({
        ...baseInput,
        deadlineDueWarningEnabled: false,
    });

    assert.equal(rows.some((row) => row.source === DEFAULT_DEADLINE_DUE_REMINDER_SOURCE), false);
});

test("default reminder rows arm the alarm only for instants the user marked urgent", () => {
    /*
     * WHAT + WHY:
     * The schedule dialog lets a default reminder be flagged urgent, which has to survive as
     * alarm_enabled on the seeded row rather than being reset to the default false.
     *
     * PASSING SCENARIO:
     * The 1H row comes back with alarm_enabled true while the other default rows stay false.
     *
     * FAILING SCENARIO:
     * If the flag were dropped, an urgent reminder would seed as a silent notification.
     */
    const deadline = new Date("2026-03-23T10:00:00.000Z");
    const rows = buildDefaultDeadlineReminderRows({
        ...baseInput,
        deadline,
        deadlineDueWarningEnabled: true,
        urgentReminderMs: new Set([deadline.getTime() - 60 * 60 * 1000]),
        now: new Date("2026-03-23T06:00:00.000Z"),
    });

    const alarmByReminderAt = new Map(rows.map((row) => [row.reminder_at, row.alarm_enabled]));
    assert.equal(alarmByReminderAt.get(new Date(deadline.getTime() - 60 * 60 * 1000).toISOString()), true);
    assert.equal(alarmByReminderAt.get(new Date(deadline.getTime() - 10 * 60 * 1000).toISOString()), false);
});

test("urgent reminder payloads survive junk without failing task creation", () => {
    /*
     * WHAT + WHY:
     * Urgency arrives as a separate JSON field next to the validated reminder list, so bad input
     * must degrade to "nothing is urgent" rather than rejecting an otherwise valid task.
     *
     * PASSING SCENARIO:
     * Valid ISO strings are parsed to timestamps; malformed payloads yield an empty set.
     *
     * FAILING SCENARIO:
     * Throwing here would surface as a failed task creation for a cosmetic flag.
     */
    const parsed = normalizeUrgentRemindersFromFormData(
        JSON.stringify(["2026-03-23T09:00:00.000Z", "not-a-date", 42])
    );
    assert.deepEqual(Array.from(parsed.values()), [new Date("2026-03-23T09:00:00.000Z").getTime()]);

    assert.equal(normalizeUrgentRemindersFromFormData("{oops").size, 0);
    assert.equal(normalizeUrgentRemindersFromFormData(null).size, 0);
    assert.equal(normalizeUrgentRemindersFromFormData(JSON.stringify({ at: "x" })).size, 0);
});
