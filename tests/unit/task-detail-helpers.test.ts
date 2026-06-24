import test from "node:test";
import assert from "node:assert/strict";
import type { TaskEvent, TaskReminder } from "../../src/lib/types";

import {
    buildVisibleEvents,
    mergeDueReminderTimelineEvents,
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
    const events: TaskEvent[] = [
        {
            id: "1",
            task_id: "task-1",
            event_type: "POMO_COMPLETED",
            actor_id: null,
            metadata: { session_id: "session-1" },
            created_at: "2026-05-01T10:00:00.000Z",
            from_status: "ACTIVE",
            to_status: "ACTIVE",
        },
        {
            id: "2",
            task_id: "task-1",
            event_type: "POMO_COMPLETED",
            actor_id: null,
            metadata: { session_id: "session-1" },
            created_at: "2026-05-01T10:01:00.000Z",
            from_status: "ACTIVE",
            to_status: "ACTIVE",
        },
    ];
    // Passing scenario: duplicate session id collapses to a single visible event.
    assert.equal(buildVisibleEvents(events).length, 1);
    // Failing scenario: without dedupe logic this would incorrectly remain at length 2.
    assert.notEqual(buildVisibleEvents(events).length, 2);
});

test("due reminder appears in the timeline when completion wins the deadline-minute race", () => {
    const reminderAt = "2026-06-24T19:00:00.000Z";
    const reminders: TaskReminder[] = [{
        id: "reminder-final-call",
        parent_task_id: "task-1",
        user_id: "user-1",
        reminder_at: reminderAt,
        source: "DEFAULT_DEADLINE_DUE",
        notified_at: reminderAt,
        created_at: "2026-06-24T17:03:00.000Z",
        updated_at: reminderAt,
    }];
    const events: TaskEvent[] = [{
        id: "mark-complete",
        task_id: "task-1",
        event_type: "MARK_COMPLETE",
        actor_id: "user-1",
        from_status: "ACTIVE",
        to_status: "AWAITING_VOUCHER",
        metadata: null,
        created_at: "2026-06-24T19:00:05.000Z",
    }];

    const merged = mergeDueReminderTimelineEvents(
        events,
        reminders,
        new Date("2026-06-24T19:00:10.000Z").getTime()
    );

    assert.deepEqual(
        merged.map((event) => event.event_type),
        ["DEADLINE_WARNING_DUE", "MARK_COMPLETE"]
    );
});

test("recorded final-call event is not duplicated by the reminder fallback", () => {
    const reminderAt = "2026-06-24T19:00:00.000Z";
    const events: TaskEvent[] = [{
        id: "recorded-final-call",
        task_id: "task-1",
        event_type: "DEADLINE_WARNING_DUE",
        actor_id: null,
        from_status: "ACTIVE",
        to_status: "ACTIVE",
        metadata: null,
        created_at: reminderAt,
    }];
    const reminders: TaskReminder[] = [{
        id: "reminder-final-call",
        parent_task_id: "task-1",
        user_id: "user-1",
        reminder_at: reminderAt,
        source: "DEFAULT_DEADLINE_DUE",
        notified_at: reminderAt,
        created_at: "2026-06-24T17:03:00.000Z",
        updated_at: reminderAt,
    }];

    const merged = mergeDueReminderTimelineEvents(
        events,
        reminders,
        new Date("2026-06-24T19:01:00.000Z").getTime()
    );

    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, "recorded-final-call");
});
