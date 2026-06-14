import test from "node:test";
import assert from "node:assert/strict";
import {
    getDeadlineMissCutoffIso,
    isDeadlineMissEligible,
} from "../../src/lib/deadline-miss-window.ts";

const deadlineIso = "2026-03-23T23:00:00.000Z";

test("deadline miss cutoff keeps the displayed deadline minute active", () => {
    const cutoffAtDeadline = getDeadlineMissCutoffIso(new Date("2026-03-23T23:00:00.000Z"));
    const cutoffAtEndOfMinute = getDeadlineMissCutoffIso(new Date("2026-03-23T23:00:59.999Z"));

    assert.equal(cutoffAtDeadline, "2026-03-23T22:59:00.000Z");
    assert.equal(cutoffAtEndOfMinute, "2026-03-23T22:59:59.999Z");
});

test("deadline miss processing starts at the first instant after the displayed minute", () => {
    assert.equal(isDeadlineMissEligible(deadlineIso, new Date("2026-03-23T23:00:00.000Z")), false);
    assert.equal(isDeadlineMissEligible(deadlineIso, new Date("2026-03-23T23:00:59.999Z")), false);
    assert.equal(isDeadlineMissEligible(deadlineIso, new Date("2026-03-23T23:01:00.000Z")), true);
});
