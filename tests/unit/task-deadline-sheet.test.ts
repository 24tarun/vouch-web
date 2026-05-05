import test from "node:test";
import assert from "node:assert/strict";
import { toDateTimeLocalValue } from "../../src/lib/datetime-local.ts";
import { resolveDateSheetDraftSubmission } from "../../src/lib/task-deadline-sheet.ts";

test("date-sheet submit includes the unsaved reminder draft when applying", () => {
    /*
     * WHAT + WHY:
     * This checks the dialog behavior behind the new popup tick button: a reminder typed into the draft field
     * must be committed even if the user skips the separate Add button and goes straight to apply/create.
     *
     * PASSING SCENARIO:
     * The resolver returns the parsed deadline plus the pending reminder draft in the final reminders array.
     *
     * FAILING SCENARIO:
     * If the pending reminder is dropped, clicking the popup tick creates the task without the reminder the user just entered.
     */
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
    /*
     * WHAT + WHY:
     * This protects the shared validation path used by both Apply and the new popup tick action.
     * The create shortcut must not bypass the rule that reminders cannot be scheduled after the task deadline.
     *
     * PASSING SCENARIO:
     * A reminder later than the selected deadline returns the same blocking validation error as the regular dialog flow.
     *
     * FAILING SCENARIO:
     * If this resolves successfully, the popup tick could create tasks with impossible reminder timing.
     */
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
    /*
     * WHAT + WHY:
     * This checks the redesigned picker contract: calendar date plus End time is still the single canonical
     * deadline value used by existing task creation.
     *
     * PASSING SCENARIO:
     * A future end datetime resolves as the submitted deadline without requiring a start time.
     *
     * FAILING SCENARIO:
     * If this rejects or changes the timestamp, the calendar picker would no longer feed the old deadline path.
     */
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
    /*
     * WHAT + WHY:
     * This protects the planned non-event behavior where Start time can be drafted without changing the
     * canonical deadline, which always comes from End time.
     *
     * PASSING SCENARIO:
     * The resolver returns both the end-time deadline and the optional start timestamp as separate values.
     *
     * FAILING SCENARIO:
     * If the deadline is replaced by the start time, ordinary tasks would be due too early.
     */
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
    /*
     * WHAT + WHY:
     * This covers the data shape used by `-event` tasks when the new picker supplies both start and end
     * instead of relying on typed `-start` and `-end` tokens.
     *
     * PASSING SCENARIO:
     * A valid start/end window resolves into distinct start and deadline/end dates.
     *
     * FAILING SCENARIO:
     * If start is dropped, event task submission falls back to token parsing and rejects picker-only windows.
     */
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
    /*
     * WHAT + WHY:
     * This guards the picker validation rule that a drafted start/end window must be chronological before it can
     * be used by event submission.
     *
     * PASSING SCENARIO:
     * End before start returns a blocking validation error.
     *
     * FAILING SCENARIO:
     * If this resolves successfully, event tasks could be created with inverted calendar bounds.
     */
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
