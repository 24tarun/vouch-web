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
    const parsed = normalizeUrgentRemindersFromFormData(
        JSON.stringify(["2026-03-23T09:00:00.000Z", "not-a-date", 42])
    );
    assert.deepEqual(Array.from(parsed.values()), [new Date("2026-03-23T09:00:00.000Z").getTime()]);

    assert.equal(normalizeUrgentRemindersFromFormData("{oops").size, 0);
    assert.equal(normalizeUrgentRemindersFromFormData(null).size, 0);
    assert.equal(normalizeUrgentRemindersFromFormData(JSON.stringify({ at: "x" })).size, 0);
});
