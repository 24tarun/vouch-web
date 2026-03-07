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
