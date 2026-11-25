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
    const normalized = normalizeReminderIsos([
        "2026-05-01T12:00:00.000Z",
        "2026-05-01T11:00:00.000Z",
        "2026-05-01T12:00:00.000Z",
    ]);
    assert.deepEqual(normalized, ["2026-05-01T11:00:00.000Z", "2026-05-01T12:00:00.000Z"]);
    assert.deepEqual(normalizeReminderIsos(["not-a-date"]), []);
});

test("splitRemindersByTime separates past/future by reference time", () => {
    const reminders = [
        { reminder_at: "2026-05-01T10:00:00.000Z" },
        { reminder_at: "2026-05-01T14:00:00.000Z" },
    ];
    const split = splitRemindersByTime(reminders, new Date("2026-05-01T12:00:00.000Z").getTime());
    assert.equal(split.pastReminders.length, 1);
    assert.equal(split.futureReminders.length, 1);
    assert.notEqual(split.pastReminders.length, 2);
});

test("buildVisibleEvents deduplicates duplicate POMO session events", () => {
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
    assert.equal(buildVisibleEvents(events).length, 1);
    assert.notEqual(buildVisibleEvents(events).length, 2);
});

test("due reminder is not synthesized after the task starts awaiting voucher", () => {
    const reminderAt = "2026-06-24T19:00:00.000Z";
    const reminders: TaskReminder[] = [{
        id: "reminder-final-call",
        parent_task_id: "task-1",
        user_id: "user-1",
        reminder_at: reminderAt,
        source: "DEFAULT_DEADLINE_DUE",
        alarm_enabled: false,
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
        created_at: "2026-06-24T18:59:00.000Z",
    }];

    const merged = mergeDueReminderTimelineEvents(
        events,
        reminders,
        new Date("2026-06-24T19:00:10.000Z").getTime(),
        "AWAITING_VOUCHER"
    );

    assert.deepEqual(merged.map((event) => event.event_type), ["MARK_COMPLETE"]);
});

test("due reminder is synthesized only for active or postponed tasks", () => {
    const reminderAt = "2026-06-24T19:00:00.000Z";
    const reminders: TaskReminder[] = [{
        id: "reminder-final-call",
        parent_task_id: "task-1",
        user_id: "user-1",
        reminder_at: reminderAt,
        source: "DEFAULT_DEADLINE_DUE",
        alarm_enabled: false,
        notified_at: reminderAt,
        created_at: "2026-06-24T17:03:00.000Z",
        updated_at: reminderAt,
    }];

    for (const status of ["ACTIVE", "POSTPONED"] as const) {
        const merged = mergeDueReminderTimelineEvents(
            [],
            reminders,
            new Date("2026-06-24T19:00:10.000Z").getTime(),
            status
        );

        assert.deepEqual(merged.map((event) => event.event_type), ["DEADLINE_WARNING_DUE"]);
    }
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
        alarm_enabled: false,
        notified_at: reminderAt,
        created_at: "2026-06-24T17:03:00.000Z",
        updated_at: reminderAt,
    }];

    const merged = mergeDueReminderTimelineEvents(
        events,
        reminders,
        new Date("2026-06-24T19:01:00.000Z").getTime(),
        "AWAITING_VOUCHER"
    );

    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, "recorded-final-call");
});
