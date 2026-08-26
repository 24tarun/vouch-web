import "./support/jsdom-env";

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";

import {
    clampClockPart,
    dateFromNow,
    InlineTaskSchedule,
    offsetBeforeDeadline,
    setClockPart,
    shiftReminderPart,
    timeOnDate,
} from "../../src/components/task-input/inline-task-schedule";

test.afterEach(() => {
    cleanup();
});

test("relative schedule shortcuts round to the minute", () => {
    const now = new Date(2099, 7, 18, 12, 34, 45, 900);
    const result = dateFromNow(now, 60);

    assert.deepEqual(
        [result.getFullYear(), result.getMonth(), result.getDate(), result.getHours(), result.getMinutes(), result.getSeconds()],
        [2099, 7, 18, 13, 34, 0]
    );
});

test("time changes keep the selected calendar date", () => {
    const selected = new Date(2099, 7, 18, 23, 0, 0, 0);
    const result = timeOnDate(selected, "08:45");

    assert.ok(result);
    assert.deepEqual(
        [result.getFullYear(), result.getMonth(), result.getDate(), result.getHours(), result.getMinutes()],
        [2099, 7, 18, 8, 45]
    );
});

test("hour and minute reminder nudges cross clock boundaries", () => {
    const selected = new Date(2099, 7, 18, 23, 58, 0, 0);

    const nextHour = shiftReminderPart(selected, "hour", 5);
    assert.deepEqual([nextHour.getDate(), nextHour.getHours(), nextHour.getMinutes()], [19, 4, 58]);

    const nextMinute = shiftReminderPart(selected, "minute", 10);
    assert.deepEqual([nextMinute.getDate(), nextMinute.getHours(), nextMinute.getMinutes()], [19, 0, 8]);
});

test("inline schedule changes days and removes reminder chips", () => {
    const deadline = new Date(2099, 7, 18, 23, 0, 0, 0);
    const reminder = new Date(2099, 7, 18, 22, 0, 0, 0);
    const deadlineChanges: Date[] = [];
    const removed: string[] = [];

    const view = render(
        React.createElement(InlineTaskSchedule, {
            deadline,
            reminders: [{ key: "manual-reminder", at: reminder }],
            onDeadlineChange: (next: Date) => {
                deadlineChanges.push(next);
                return true;
            },
            onAddReminder: () => true,
            onRemoveReminder: (key: string) => removed.push(key),
        })
    );

    assert.ok(view.getByRole("group", { name: "Deadline" }));
    assert.ok(view.getByRole("group", { name: "Reminders" }));

    fireEvent.click(view.getByLabelText("Next deadline day"));
    assert.equal(deadlineChanges[0]?.getDate(), 19);

    fireEvent.click(view.getByLabelText("Delete reminder 22:00 18/08/2099"));
    assert.deepEqual(removed, ["manual-reminder"]);
});

test("clicking the displayed day opens its calendar dropdown", () => {
    const deadline = new Date(2099, 7, 18, 23, 0, 0, 0);
    const view = render(
        React.createElement(InlineTaskSchedule, {
            deadline,
            reminders: [],
            onDeadlineChange: () => true,
            onAddReminder: () => true,
            onRemoveReminder: () => undefined,
        })
    );

    fireEvent.click(view.getByRole("button", { name: /18 Aug 2099/i }));
    assert.ok(view.getByText("August 2099"));
});

test("each reminder renders as a line with time, date and delete", () => {
    const deadline = new Date(2099, 7, 18, 23, 0, 0, 0);
    const removed: string[] = [];

    const view = render(
        React.createElement(InlineTaskSchedule, {
            deadline,
            reminders: [
                { key: "default-1h", at: new Date(2099, 7, 18, 22, 0, 0, 0) },
                { key: "default-10m", at: new Date(2099, 7, 18, 22, 50, 0, 0) },
            ],
            onDeadlineChange: () => true,
            onAddReminder: () => true,
            onRemoveReminder: (key: string) => removed.push(key),
        })
    );

    assert.ok(view.getByText("22:00"));
    assert.ok(view.getByText("22:50"));
    assert.equal(view.getAllByText("18/08/2099").length, 2);
    assert.equal(view.getAllByText("scheduled").length, 2);

    fireEvent.click(view.getByLabelText("Delete reminder 22:50 18/08/2099"));
    assert.deepEqual(removed, ["default-10m"]);
});

test("the alarm toggle only appears when alarm notifications are enabled", () => {
    const deadline = new Date(2099, 7, 18, 23, 0, 0, 0);
    const reminders = [{ key: "default-1h", at: new Date(2099, 7, 18, 22, 0, 0, 0) }];
    const toggled: string[] = [];

    const withoutAlarms = render(
        React.createElement(InlineTaskSchedule, {
            deadline,
            reminders,
            onDeadlineChange: () => true,
            onAddReminder: () => true,
            onRemoveReminder: () => undefined,
        })
    );
    assert.equal(withoutAlarms.queryByText("Alarm"), null);
    cleanup();

    const withAlarms = render(
        React.createElement(InlineTaskSchedule, {
            deadline,
            reminders,
            alarmNotificationsEnabled: true,
            urgentReminderKeys: [],
            onToggleUrgentReminder: (key: string) => toggled.push(key),
            onDeadlineChange: () => true,
            onAddReminder: () => true,
            onRemoveReminder: () => undefined,
        })
    );

    const alarmButton = withAlarms.getByText("Alarm");
    assert.equal(alarmButton.getAttribute("aria-pressed"), "false");
    fireEvent.click(alarmButton);
    assert.deepEqual(toggled, ["default-1h"]);
});

test("reminder presets are anchored to the deadline", () => {
    const deadline = new Date(2099, 7, 18, 23, 0, 0, 0);

    const tenBefore = offsetBeforeDeadline(deadline, 10);
    assert.deepEqual([tenBefore.getHours(), tenBefore.getMinutes()], [22, 50]);

    const dayBefore = offsetBeforeDeadline(deadline, 24 * 60);
    assert.deepEqual([dayBefore.getDate(), dayBefore.getHours()], [17, 23]);
});

test("add reminder opens a popover whose clock commits the chosen time", () => {
    const deadline = new Date(2099, 7, 18, 23, 0, 0, 0);
    const added: Date[] = [];

    const view = render(
        React.createElement(InlineTaskSchedule, {
            deadline,
            reminders: [],
            onDeadlineChange: () => true,
            onAddReminder: (next: Date) => {
                added.push(next);
                return true;
            },
            onRemoveReminder: () => undefined,
        })
    );

    assert.equal(view.queryByLabelText("Reminder hour"), null);

    fireEvent.click(view.getByRole("button", { name: "Add reminder" }));

    const hourInput = view.getByLabelText("Reminder hour") as HTMLInputElement;
    fireEvent.change(hourInput, { target: { value: "21" } });
    fireEvent.blur(hourInput);

    const minuteInput = view.getByLabelText("Reminder minute") as HTMLInputElement;
    fireEvent.change(minuteInput, { target: { value: "45" } });
    fireEvent.blur(minuteInput);

    fireEvent.click(view.getByRole("button", { name: "Confirm reminder" }));

    assert.equal(added.length, 1);
    assert.deepEqual([added[0].getHours(), added[0].getMinutes()], [21, 45]);
});

test("typed clock parts are clamped to their valid range", () => {
    assert.equal(clampClockPart("7", "hour"), 7);
    assert.equal(clampClockPart("99", "hour"), 23);
    assert.equal(clampClockPart("99", "minute"), 59);
    assert.equal(clampClockPart("", "minute"), null);

    const base = new Date(2099, 7, 18, 23, 0, 0, 0);
    const withHour = setClockPart(base, "hour", 7);
    assert.deepEqual([withHour.getDate(), withHour.getHours(), withHour.getMinutes()], [18, 7, 0]);
});

test("deadline hour and minute share one stepper line", () => {
    const deadline = new Date(2099, 7, 18, 23, 0, 0, 0);
    const changes: Date[] = [];

    const view = render(
        React.createElement(InlineTaskSchedule, {
            deadline,
            reminders: [],
            onDeadlineChange: (next: Date) => {
                changes.push(next);
                return true;
            },
            onAddReminder: () => true,
            onRemoveReminder: () => undefined,
        })
    );

    assert.equal((view.getByLabelText("Deadline hour") as HTMLInputElement).value, "23");
    assert.equal((view.getByLabelText("Deadline minute") as HTMLInputElement).value, "00");

    // The coarse -10/+10 steppers are gone; only single steps remain.
    assert.equal(view.queryByLabelText("Deadline hour minus 10"), null);
    assert.equal(view.queryByLabelText("Deadline minute plus 10"), null);

    fireEvent.click(view.getByLabelText("Deadline hour minus 1"));
    assert.equal(changes.at(-1)?.getHours(), 22);

    fireEvent.click(view.getByLabelText("Deadline minute plus 1"));
    assert.equal(changes.at(-1)?.getMinutes(), 1);

    for (const label of ["in 1 hour", "in 3 hours", "in 6 hours"]) {
        assert.ok(view.getByRole("button", { name: `Set deadline ${label}` }));
    }
    assert.ok(view.getByLabelText("Set deadline tomorrow at 9am"));
});

test("typing into the hour cell commits a clamped deadline", () => {
    const deadline = new Date(2099, 7, 18, 23, 0, 0, 0);
    const changes: Date[] = [];

    const view = render(
        React.createElement(InlineTaskSchedule, {
            deadline,
            reminders: [],
            onDeadlineChange: (next: Date) => {
                changes.push(next);
                return true;
            },
            onAddReminder: () => true,
            onRemoveReminder: () => undefined,
        })
    );

    const hourInput = view.getByLabelText("Deadline hour");
    fireEvent.change(hourInput, { target: { value: "45" } });
    fireEvent.blur(hourInput);

    assert.equal(changes.at(-1)?.getHours(), 23);
});

test("reset restores the default deadline only when a handler is provided", () => {
    const deadline = new Date(2099, 7, 18, 23, 0, 0, 0);

    const withoutReset = render(
        React.createElement(InlineTaskSchedule, {
            deadline,
            reminders: [],
            onDeadlineChange: () => true,
            onAddReminder: () => true,
            onRemoveReminder: () => undefined,
        })
    );
    assert.equal(withoutReset.queryByLabelText("Reset deadline"), null);
    cleanup();

    let resets = 0;
    const withReset = render(
        React.createElement(InlineTaskSchedule, {
            deadline,
            reminders: [],
            onDeadlineChange: () => true,
            onAddReminder: () => true,
            onRemoveReminder: () => undefined,
            onResetDeadline: () => {
                resets += 1;
            },
        })
    );

    fireEvent.click(withReset.getByLabelText("Reset deadline"));
    assert.equal(resets, 1);
});
