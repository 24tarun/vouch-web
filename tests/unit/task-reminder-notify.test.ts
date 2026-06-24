import test from "node:test";
import assert from "node:assert/strict";
import {
    buildReminderRemoteDeliveryMarkerData,
    buildReminderNotificationParams,
    getReminderLocalBackupKey,
    groupReminderNotificationEntries,
    isReminderTaskActive,
    type ReminderNotificationEntry,
} from "../../src/trigger/task-reminder-notify.ts";

function entry(input: {
    reminderId: string;
    taskId: string;
    title: string;
    source: string;
    reminderAt?: string;
    userId?: string;
    status?: ReminderNotificationEntry["task"]["status"];
}): ReminderNotificationEntry {
    return {
        reminder: {
            id: input.reminderId,
            parent_task_id: input.taskId,
            user_id: input.userId ?? "user-1",
            reminder_at: input.reminderAt ?? "2026-03-23T22:00:30.000Z",
            source: input.source,
        },
        task: {
            id: input.taskId,
            title: input.title,
            status: input.status ?? "ACTIVE",
            user_id: input.userId ?? "user-1",
        },
        eventType: input.source === "DEFAULT_DEADLINE_DUE"
            ? "DEADLINE_WARNING_DUE"
            : input.source === "DEFAULT_DEADLINE_10M"
                ? "DEADLINE_WARNING_10M"
                : input.source === "DEFAULT_DEADLINE_1H"
                    ? "DEADLINE_WARNING_1H"
                    : null,
    };
}

test("groups reminder notifications by user, source, and reminder minute", () => {
    const groups = groupReminderNotificationEntries([
        entry({ reminderId: "reminder-1", taskId: "task-1", title: "A", source: "DEFAULT_DEADLINE_1H" }),
        entry({ reminderId: "reminder-2", taskId: "task-2", title: "B", source: "DEFAULT_DEADLINE_1H", reminderAt: "2026-03-23T22:00:59.000Z" }),
        entry({ reminderId: "reminder-3", taskId: "task-3", title: "C", source: "DEFAULT_DEADLINE_10M" }),
    ]);

    assert.equal(groups.length, 2);
    assert.equal(groups[0].entries.length, 2);
    assert.equal(groups[0].reminderAtMinute, "2026-03-23T22:00:00.000Z");
    assert.equal(groups[1].entries.length, 1);
});

test("single reminder notification keeps task-specific payload", () => {
    const [group] = groupReminderNotificationEntries([
        entry({ reminderId: "reminder-1", taskId: "task-1", title: "Pay rent", source: "DEFAULT_DEADLINE_10M" }),
    ]);

    const params = buildReminderNotificationParams(group);

    assert.equal(params.title, "Deadline in 10 minutes");
    assert.equal(params.text, "10 minutes left for Pay rent");
    assert.equal(params.url, "/tasks/task-1");
    assert.equal(params.tag, "deadline-reminder-reminder-1");
    assert.deepEqual(params.data, {
        taskId: "task-1",
        reminderId: "reminder-1",
        localBackupKey: "reminder-1",
        kind: "DEADLINE_WARNING_10M",
        category: "DEADLINE_REMINDER",
        reminderAt: "2026-03-23T22:00:30.000Z",
        source: "DEFAULT_DEADLINE_10M",
    });
});

test("multiple same-minute reminders produce one aggregate payload", () => {
    const [group] = groupReminderNotificationEntries([
        entry({ reminderId: "reminder-1", taskId: "task-1", title: "A", source: "DEFAULT_DEADLINE_1H" }),
        entry({ reminderId: "reminder-2", taskId: "task-2", title: "B", source: "DEFAULT_DEADLINE_1H" }),
    ]);

    const params = buildReminderNotificationParams(group);

    assert.equal(params.title, "Task reminders");
    assert.equal(params.text, "2 tasks need attention.");
    assert.equal(params.url, "/tasks");
    assert.match(params.tag ?? "", /^deadline-reminder-aggregate-user-1-DEFAULT_DEADLINE_1H-/);
    assert.deepEqual(params.data, {
        aggregate: true,
        localBackupKey: "aggregate|DEFAULT_DEADLINE_1H|2026-03-23T22:00:00.000Z",
        taskIds: ["task-1", "task-2"],
        reminderIds: ["reminder-1", "reminder-2"],
        count: 2,
        source: "DEFAULT_DEADLINE_1H",
        reminderAt: "2026-03-23T22:00:00.000Z",
        url: "/tasks",
        kind: "DEADLINE_REMINDER",
        category: "DEADLINE_REMINDER",
    });
});

test("inactive tasks are excluded before grouping reminder notifications", () => {
    const candidateEntries = [
        entry({ reminderId: "reminder-1", taskId: "task-1", title: "Active", source: "DEFAULT_DEADLINE_DUE" }),
        entry({
            reminderId: "reminder-2",
            taskId: "task-2",
            title: "Completed",
            source: "DEFAULT_DEADLINE_DUE",
            status: "AWAITING_VOUCHER",
        }),
    ];
    const activeEntries = candidateEntries.filter((candidate) => isReminderTaskActive(candidate.task));
    const [group] = groupReminderNotificationEntries(activeEntries);
    const params = buildReminderNotificationParams(group);

    assert.equal(params.title, "Final call");
    assert.equal(params.text, 'Mark "Active" complete now or it will be missed.');
    assert.equal((params.data as Record<string, unknown>).reminderId, "reminder-1");
    assert.equal((params.data as Record<string, unknown>).aggregate, undefined);
});

test("no reminder group is produced when every task is inactive", () => {
    const inactiveEntries = [
        entry({
            reminderId: "reminder-1",
            taskId: "task-1",
            title: "Awaiting voucher",
            source: "DEFAULT_DEADLINE_DUE",
            status: "AWAITING_VOUCHER",
        }),
        entry({
            reminderId: "reminder-2",
            taskId: "task-2",
            title: "Missed",
            source: "DEFAULT_DEADLINE_DUE",
            status: "MISSED",
        }),
    ];
    const activeEntries = inactiveEntries.filter((candidate) => isReminderTaskActive(candidate.task));

    assert.deepEqual(groupReminderNotificationEntries(activeEntries), []);
});

test("due-time aggregate reminder uses final-call copy", () => {
    const [group] = groupReminderNotificationEntries([
        entry({ reminderId: "reminder-1", taskId: "task-1", title: "A", source: "DEFAULT_DEADLINE_DUE" }),
        entry({ reminderId: "reminder-2", taskId: "task-2", title: "B", source: "DEFAULT_DEADLINE_DUE" }),
    ]);

    const params = buildReminderNotificationParams(group);

    assert.equal(params.title, "Final call");
    assert.equal(params.text, "Last call for 2 tasks.");
    assert.equal((params.data as Record<string, unknown>).kind, "DEADLINE_FINAL_CALL");
});

test("manual reminders aggregate when simultaneous", () => {
    const [group] = groupReminderNotificationEntries([
        entry({ reminderId: "reminder-1", taskId: "task-1", title: "A", source: "MANUAL" }),
        entry({ reminderId: "reminder-2", taskId: "task-2", title: "B", source: "MANUAL" }),
    ]);

    const params = buildReminderNotificationParams(group);

    assert.equal(params.title, "Task reminders");
    assert.equal(params.text, "2 tasks need attention.");
    assert.match(params.tag ?? "", /^task-reminder-aggregate-user-1-MANUAL-/);
});

test("remote delivery marker uses stable single and aggregate backup keys", () => {
    const [singleGroup] = groupReminderNotificationEntries([
        entry({ reminderId: "reminder-1", taskId: "task-1", title: "A", source: "DEFAULT_DEADLINE_10M" }),
    ]);
    const [aggregateGroup] = groupReminderNotificationEntries([
        entry({ reminderId: "reminder-1", taskId: "task-1", title: "A", source: "DEFAULT_DEADLINE_1H" }),
        entry({ reminderId: "reminder-2", taskId: "task-2", title: "B", source: "DEFAULT_DEADLINE_1H" }),
    ]);

    assert.equal(getReminderLocalBackupKey(singleGroup), "reminder-1");
    assert.equal(
        getReminderLocalBackupKey(aggregateGroup),
        "aggregate|DEFAULT_DEADLINE_1H|2026-03-23T22:00:00.000Z"
    );
    assert.deepEqual(buildReminderRemoteDeliveryMarkerData(aggregateGroup), {
        kind: "TASK_REMINDER_REMOTE_DELIVERED",
        category: "DEADLINE_REMINDER",
        localBackupKey: "aggregate|DEFAULT_DEADLINE_1H|2026-03-23T22:00:00.000Z",
        taskIds: ["task-1", "task-2"],
        reminderIds: ["reminder-1", "reminder-2"],
        count: 2,
        source: "DEFAULT_DEADLINE_1H",
        reminderAt: "2026-03-23T22:00:00.000Z",
        aggregate: true,
    });
});
