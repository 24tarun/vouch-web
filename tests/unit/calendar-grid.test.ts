import assert from "node:assert/strict";
import test from "node:test";
import {
    BLOCK_AFTER_DEADLINE_ERROR,
    dateAtSlot,
    groupDeadlinePins,
    layoutOverlaps,
    maxEndSlotBeforeDeadline,
    startOfWeekMonday,
    validateBlockRange,
} from "../../src/lib/calendar/grid";
import { countBlocksPastDeadline, getPinLockReason, validatePostponeTarget } from "../../src/lib/calendar/pins";

const Q = 15 * 60 * 1000;

test("weeks start on Monday", () => {
    const sunday = new Date(2026, 10, 22, 15, 30);
    const monday = startOfWeekMonday(sunday);
    assert.equal(monday.getDay(), 1);
    assert.equal(monday.getDate(), 16);
    assert.equal(monday.getHours(), 0);
    assert.equal(startOfWeekMonday(new Date(2026, 10, 16, 0, 0)).getDate(), 16);
});

test("slots map to local quarter hours and slot 96 is next midnight", () => {
    const day = new Date(2026, 10, 18);
    const at = dateAtSlot(day, 22);
    assert.equal(at.getHours(), 5);
    assert.equal(at.getMinutes(), 30);
    const end = dateAtSlot(day, 96);
    assert.equal(end.getDate(), 19);
    assert.equal(end.getHours(), 0);
});

test("deadlines in the same 15-minute cell share one pin", () => {
    const pins = groupDeadlinePins([
        { id: "b", deadlineIso: new Date(2026, 10, 18, 23, 59).toISOString() },
        { id: "a", deadlineIso: new Date(2026, 10, 18, 23, 45).toISOString() },
        { id: "c", deadlineIso: new Date(2026, 10, 18, 22, 0).toISOString() },
        { id: "d", deadlineIso: new Date(2026, 10, 19, 23, 50).toISOString() },
    ]);
    assert.equal(pins.length, 3);
    const lateGroup = pins.find((pin) => pin.items.length === 2);
    assert.ok(lateGroup);
    assert.deepEqual(lateGroup.items.map((item) => item.id), ["a", "b"]);
    assert.equal(lateGroup.anchorIso, new Date(2026, 10, 18, 23, 45).toISOString());
    assert.equal(pins[0].items[0].id, "c");
});

test("overlapping blocks sit side by side; touching blocks do not overlap", () => {
    const layout = layoutOverlaps([
        { id: "a", startMs: 0, endMs: 4 * Q },
        { id: "b", startMs: 2 * Q, endMs: 6 * Q },
        { id: "c", startMs: 4 * Q, endMs: 5 * Q },
        { id: "d", startMs: 8 * Q, endMs: 9 * Q },
    ]);
    assert.deepEqual(layout.get("a"), { column: 0, columns: 2 });
    assert.deepEqual(layout.get("b"), { column: 1, columns: 2 });
    assert.deepEqual(layout.get("c"), { column: 0, columns: 2 });
    assert.deepEqual(layout.get("d"), { column: 0, columns: 1 });
});

test("blocks must be quarter-aligned and end by the deadline", () => {
    const start = Date.UTC(2026, 10, 18, 9, 0);
    assert.equal(validateBlockRange(start, start + 2 * Q, start + 2 * Q), null);
    assert.equal(validateBlockRange(start, start + 3 * Q, start + 2 * Q), BLOCK_AFTER_DEADLINE_ERROR);
    assert.match(validateBlockRange(start + 60_000, start + 2 * Q, Infinity) ?? "", /15-minute/);
    assert.match(validateBlockRange(start, start, Infinity) ?? "", /at least/);
});

test("resize stops at the last quarter before the deadline on its day", () => {
    const day = new Date(2026, 10, 18);
    assert.equal(maxEndSlotBeforeDeadline(day, new Date(2026, 10, 18, 23, 59).getTime()), 95);
    assert.equal(maxEndSlotBeforeDeadline(day, new Date(2026, 10, 18, 10, 0).getTime()), 40);
    assert.equal(maxEndSlotBeforeDeadline(day, new Date(2026, 10, 20, 10, 0).getTime()), 96);
    assert.equal(maxEndSlotBeforeDeadline(day, new Date(2026, 10, 17, 10, 0).getTime()), 0);
});

const now = new Date("2026-11-22T10:00:00Z");
const baseTask = {
    status: "ACTIVE" as const,
    postponed_at: null,
    deadline: "2026-11-23T22:00:00.000Z",
    google_sync_for_task: false,
    is_strict: false,
    daily_rule_timezone: null,
};

test("pins lock once postponed, for events, and after the deadline", () => {
    assert.equal(getPinLockReason(baseTask, now), null);
    assert.equal(getPinLockReason({ ...baseTask, status: "POSTPONED", postponed_at: "2026-11-21T00:00:00Z" }, now), "Already postponed once");
    assert.equal(getPinLockReason({ ...baseTask, google_sync_for_task: true }, now), "Events are locked");
    assert.equal(getPinLockReason({ ...baseTask, google_sync_for_task: true, is_strict: true }, now), "Strict tasks are locked");
    assert.equal(getPinLockReason({ ...baseTask, deadline: "2026-11-22T09:00:00Z" }, now), "Deadline has passed");
    assert.equal(getPinLockReason({ ...baseTask, status: "MISSED" as never }, now), "Task is no longer active");
});

test("postpone targets mirror postpone_task_v2 rules", () => {
    assert.equal(validatePostponeTarget(baseTask, Date.parse("2026-11-24T22:00:00Z"), now), null);
    assert.match(validatePostponeTarget(baseTask, Date.parse("2026-11-22T09:00:00Z"), now) ?? "", /future/);
    const daily = { ...baseTask, daily_rule_timezone: "Europe/Berlin" };
    assert.equal(validatePostponeTarget(daily, Date.parse("2026-11-23T22:45:00Z"), now), null);
    assert.match(validatePostponeTarget(daily, Date.parse("2026-11-23T23:15:00Z"), now) ?? "", /same day/);
});

test("counts blocks that a shorter deadline would remove", () => {
    const blocks = [{ end_at: "2026-11-23T10:00:00Z" }, { end_at: "2026-11-23T12:00:00Z" }];
    assert.equal(countBlocksPastDeadline(blocks, Date.parse("2026-11-23T11:00:00Z")), 1);
});
