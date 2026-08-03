import assert from "node:assert/strict";
import test from "node:test";
import { getDefaultDeadline } from "../../src/lib/task-title-parser";

test("default task deadline uses the configured time today when it is still ahead", () => {
    const now = new Date(2026, 7, 3, 14, 0, 0);
    const deadline = getDefaultDeadline(now, "15:00");

    assert.equal(deadline.getFullYear(), 2026);
    assert.equal(deadline.getMonth(), 7);
    assert.equal(deadline.getDate(), 3);
    assert.equal(deadline.getHours(), 15);
    assert.equal(deadline.getMinutes(), 0);
});

test("midnight default means the next upcoming midnight", () => {
    const now = new Date(2026, 7, 3, 14, 0, 0);
    const deadline = getDefaultDeadline(now, "00:00");

    assert.equal(deadline.getDate(), 4);
    assert.equal(deadline.getHours(), 0);
    assert.equal(deadline.getMinutes(), 0);
});

test("invalid saved deadline time falls back to 23:00", () => {
    const now = new Date(2026, 7, 3, 14, 0, 0);
    const deadline = getDefaultDeadline(now, "not-a-time");

    assert.equal(deadline.getHours(), 23);
    assert.equal(deadline.getMinutes(), 0);
});
