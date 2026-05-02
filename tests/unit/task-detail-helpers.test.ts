import test from "node:test";
import assert from "node:assert/strict";

import {
    buildVisibleEvents,
    normalizeReminderIsos,
    splitRemindersByTime,
} from "../../src/app/(app)/tasks/[id]/task-detail/utils/task-detail-helpers";

test("normalizeReminderIsos deduplicates and sorts reminder timestamps", () => {
    // What/why: ensures reminder optimistic updates remain deterministic after helper extraction.
    const normalized = normalizeReminderIsos([
        "2026-05-01T12:00:00.000Z",
        "2026-05-01T11:00:00.000Z",
        "2026-05-01T12:00:00.000Z",
    ]);
    // Passing scenario: duplicate timestamps collapse and output is sorted ascending.
    assert.deepEqual(normalized, ["2026-05-01T11:00:00.000Z", "2026-05-01T12:00:00.000Z"]);
    // Failing scenario: invalid reminder strings are ignored instead of corrupting output.
    assert.deepEqual(normalizeReminderIsos(["not-a-date"]), []);
});

test("splitRemindersByTime separates past/future by reference time", () => {
    // What/why: validates reminder partition used by replace-future-only behavior.
    const reminders = [
        { reminder_at: "2026-05-01T10:00:00.000Z" },
        { reminder_at: "2026-05-01T14:00:00.000Z" },
    ];
    // Passing scenario: one reminder before and one after the reference point.
    const split = splitRemindersByTime(reminders, new Date("2026-05-01T12:00:00.000Z").getTime());
    assert.equal(split.pastReminders.length, 1);
    assert.equal(split.futureReminders.length, 1);
    // Failing scenario: if partitioning regressed, both lists would not match expected sizes.
    assert.notEqual(split.pastReminders.length, 2);
});

test("buildVisibleEvents deduplicates duplicate POMO session events", () => {
    // What/why: protects activity timeline from duplicated session entries.
    const events = [
        {
            id: "1",
            event_type: "POMO_COMPLETED",
            metadata: { session_id: "session-1" },
            created_at: "2026-05-01T10:00:00.000Z",
            from_status: "ACTIVE",
            to_status: "ACTIVE",
        },
        {
            id: "2",
            event_type: "POMO_COMPLETED",
            metadata: { session_id: "session-1" },
            created_at: "2026-05-01T10:01:00.000Z",
            from_status: "ACTIVE",
            to_status: "ACTIVE",
        },
    ] as any;
    // Passing scenario: duplicate session id collapses to a single visible event.
    assert.equal(buildVisibleEvents(events).length, 1);
    // Failing scenario: without dedupe logic this would incorrectly remain at length 2.
    assert.notEqual(buildVisibleEvents(events).length, 2);
});
