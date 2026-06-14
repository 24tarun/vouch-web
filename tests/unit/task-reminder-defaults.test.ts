import test from "node:test";
import assert from "node:assert/strict";
import {
    buildDefaultDeadlineReminderRows,
    DEFAULT_DEADLINE_DUE_REMINDER_SOURCE,
} from "../../src/lib/task-reminder-defaults.ts";

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
