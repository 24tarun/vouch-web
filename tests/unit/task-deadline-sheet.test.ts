import test from "node:test";
import assert from "node:assert/strict";
import { toDateTimeLocalValue } from "../../src/lib/datetime-local.ts";
import {
    DEFAULT_ONE_HOUR_REMINDER_KEY,
    DEFAULT_TEN_MINUTE_REMINDER_KEY,
    manualReminderKey,
    resolveDateSheetDraftSubmission,
    resolveUrgentReminderIsos,
} from "../../src/lib/task-deadline-sheet.ts";

test("date-sheet submit includes the unsaved reminder draft when applying", () => {
    const now = new Date(2026, 2, 8, 12, 0, 0, 0);
    const deadline = new Date(2026, 2, 8, 18, 0, 0, 0);
    const reminder = new Date(2026, 2, 8, 17, 30, 0, 0);

    const result = resolveDateSheetDraftSubmission({
        deadlineDraftValue: toDateTimeLocalValue(deadline),
        reminderDraftValue: toDateTimeLocalValue(reminder),
        remindersDraft: [],
        nowMs: now.getTime(),
    });

    assert.ok(!("error" in result));
    assert.equal(result.deadline.getTime(), deadline.getTime());
    assert.equal(result.eventStart, null);
    assert.deepEqual(result.reminders.map((entry) => entry.getTime()), [reminder.getTime()]);
});

test("date-sheet submit rejects reminders after the chosen deadline", () => {
    const now = new Date(2026, 2, 8, 12, 0, 0, 0);
    const deadline = new Date(2026, 2, 8, 18, 0, 0, 0);
    const invalidReminder = new Date(2026, 2, 8, 18, 30, 0, 0);

    const result = resolveDateSheetDraftSubmission({
        deadlineDraftValue: toDateTimeLocalValue(deadline),
        reminderDraftValue: toDateTimeLocalValue(invalidReminder),
        remindersDraft: [],
        nowMs: now.getTime(),
    });

    assert.deepEqual(result, {
        error: "Reminders must be in the future and before or at the deadline.",
    });
});

test("date-sheet submit resolves selected date and end time as the deadline", () => {
    const now = new Date(2026, 4, 5, 9, 0, 0, 0);
    const end = new Date(2026, 4, 6, 18, 45, 0, 0);

    const result = resolveDateSheetDraftSubmission({
        deadlineDraftValue: toDateTimeLocalValue(end),
        reminderDraftValue: "",
        remindersDraft: [],
        nowMs: now.getTime(),
    });

    assert.ok(!("error" in result));
    assert.equal(result.deadline.getTime(), end.getTime());
    assert.equal(result.eventStart, null);
});

test("date-sheet submit keeps optional start time separate from non-event deadline", () => {
    const now = new Date(2026, 4, 5, 9, 0, 0, 0);
    const start = new Date(2026, 4, 6, 9, 30, 0, 0);
    const end = new Date(2026, 4, 6, 18, 0, 0, 0);

    const result = resolveDateSheetDraftSubmission({
        deadlineDraftValue: toDateTimeLocalValue(end),
        eventStartDraftValue: toDateTimeLocalValue(start),
        reminderDraftValue: "",
        remindersDraft: [],
        nowMs: now.getTime(),
    });

    assert.ok(!("error" in result));
    assert.equal(result.deadline.getTime(), end.getTime());
    assert.equal(result.eventStart?.getTime(), start.getTime());
});

test("date-sheet submit returns event boundaries for a picker start and end window", () => {
    const now = new Date(2026, 4, 5, 9, 0, 0, 0);
    const start = new Date(2026, 4, 7, 14, 0, 0, 0);
    const end = new Date(2026, 4, 7, 15, 30, 0, 0);

    const result = resolveDateSheetDraftSubmission({
        deadlineDraftValue: toDateTimeLocalValue(end),
        eventStartDraftValue: toDateTimeLocalValue(start),
        reminderDraftValue: "",
        remindersDraft: [],
        nowMs: now.getTime(),
    });

    assert.ok(!("error" in result));
    assert.equal(result.eventStart?.getTime(), start.getTime());
    assert.equal(result.deadline.getTime(), end.getTime());
});

test("date-sheet submit rejects an end time before a start time", () => {
    const now = new Date(2026, 4, 5, 9, 0, 0, 0);
    const start = new Date(2026, 4, 7, 15, 30, 0, 0);
    const end = new Date(2026, 4, 7, 14, 0, 0, 0);

    const result = resolveDateSheetDraftSubmission({
        deadlineDraftValue: toDateTimeLocalValue(end),
        eventStartDraftValue: toDateTimeLocalValue(start),
        reminderDraftValue: "",
        remindersDraft: [],
        nowMs: now.getTime(),
    });

    assert.deepEqual(result, {
        error: "End time must be after start time.",
    });
});

test("urgent reminder keys resolve against the deadline that is actually submitted", () => {
    const deadline = new Date(2026, 7, 17, 23, 0, 0, 0);
    const manualReminder = new Date(2026, 7, 17, 9, 0, 0, 0);

    const isos = resolveUrgentReminderIsos(
        [DEFAULT_ONE_HOUR_REMINDER_KEY, DEFAULT_TEN_MINUTE_REMINDER_KEY, manualReminderKey(manualReminder)],
        deadline
    );

    assert.deepEqual(isos, [
        manualReminder.toISOString(),
        new Date(deadline.getTime() - 60 * 60 * 1000).toISOString(),
        new Date(deadline.getTime() - 10 * 60 * 1000).toISOString(),
    ].sort());
});

test("unknown urgency keys are ignored instead of poisoning the alarm list", () => {
    const deadline = new Date(2026, 7, 17, 23, 0, 0, 0);

    assert.deepEqual(resolveUrgentReminderIsos(["nonsense", "manual-not-a-date"], deadline), []);
});
