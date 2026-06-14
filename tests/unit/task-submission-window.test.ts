import test from "node:test";
import assert from "node:assert/strict";
import {
    getTaskSubmissionWindowState,
    isWithinInclusiveDeadlineMinute,
} from "../../src/lib/task-submission-window.ts";

function buildIso(
    year: number,
    monthIndex: number,
    day: number,
    hours: number,
    minutes: number
): string {
    return new Date(year, monthIndex, day, hours, minutes, 0, 0).toISOString();
}

test("submission is allowed when no start is provided and deadline is still in future", () => {
    /*
     * What and why this test checks:
     * This verifies start-time enforcement stays optional and does not block tasks that only have a deadline.
     *
     * Passing scenario:
     * Without a start timestamp and with a future deadline, canSubmitNow is true and beforeStart is false.
     *
     * Failing scenario:
     * If this becomes blocked, non-event and legacy tasks could become impossible to submit before deadline.
     */
    const now = new Date("2026-03-23T09:00:00.000Z");
    const state = getTaskSubmissionWindowState({
        startAtIso: null,
        deadlineIso: "2026-03-23T10:00:00.000Z",
        now,
    });

    assert.equal(state.beforeStart, false);
    assert.equal(state.pastDeadline, false);
    assert.equal(state.canSubmitNow, true);
    assert.equal(state.completionBlocked, false);
});

test("submission is blocked before start when start is in the future", () => {
    /*
     * What and why this test checks:
     * This validates the new gate that prevents submission before the configured start boundary.
     *
     * Passing scenario:
     * With now earlier than start and deadline still future, beforeStart is true and canSubmitNow is false.
     *
     * Failing scenario:
     * If beforeStart is false here, users could submit tasks earlier than the allowed interval.
     */
    const state = getTaskSubmissionWindowState({
        startAtIso: "2026-03-23T10:00:00.000Z",
        deadlineIso: "2026-03-23T12:00:00.000Z",
        isStrict: true,
        now: new Date("2026-03-23T09:59:00.000Z"),
    });

    assert.equal(state.beforeStart, true);
    assert.equal(state.pastDeadline, false);
    assert.equal(state.canSubmitNow, false);
    assert.equal(state.completionBlocked, true);
});

test("submission is allowed exactly at start time", () => {
    /*
     * What and why this test checks:
     * This checks the inclusive boundary contract where submission opens at the exact start timestamp.
     *
     * Passing scenario:
     * When now equals start and deadline is later, beforeStart is false and canSubmitNow is true.
     *
     * Failing scenario:
     * If equality is treated as blocked, users would be forced to wait past the configured start instant.
     */
    const atStartIso = "2026-03-23T10:00:00.000Z";
    const state = getTaskSubmissionWindowState({
        startAtIso: atStartIso,
        deadlineIso: "2026-03-23T11:00:00.000Z",
        now: new Date(atStartIso),
    });

    assert.equal(state.beforeStart, false);
    assert.equal(state.pastDeadline, false);
    assert.equal(state.canSubmitNow, true);
    assert.equal(state.completionBlocked, false);
});

test("submission is allowed when start time is already in the past", () => {
    /*
     * What and why this test checks:
     * This ensures start gating only blocks early submissions and stops blocking after start has passed.
     *
     * Passing scenario:
     * With now after start and before deadline, beforeStart is false and canSubmitNow is true.
     *
     * Failing scenario:
     * If this still blocks, tasks would remain permanently un-submittable after reaching their start window.
     */
    const state = getTaskSubmissionWindowState({
        startAtIso: buildIso(2026, 2, 23, 8, 0),
        deadlineIso: buildIso(2026, 2, 23, 12, 0),
        now: new Date(buildIso(2026, 2, 23, 9, 30)),
    });

    assert.equal(state.beforeStart, false);
    assert.equal(state.pastDeadline, false);
    assert.equal(state.canSubmitNow, true);
    assert.equal(state.completionBlocked, false);
});

test("invalid start timestamp is treated as absent and does not block submission", () => {
    /*
     * What and why this test checks:
     * This guards robustness for malformed start values so invalid data does not accidentally lock submission.
     *
     * Passing scenario:
     * A malformed start value yields startDate=null and does not set beforeStart when deadline is still in future.
     *
     * Failing scenario:
     * If invalid start values block submission, bad imported rows could become impossible to complete.
     */
    const state = getTaskSubmissionWindowState({
        startAtIso: "not-a-real-date",
        deadlineIso: "2026-03-23T12:00:00.000Z",
        now: new Date("2026-03-23T09:00:00.000Z"),
    });

    assert.equal(state.startDate, null);
    assert.equal(state.beforeStart, false);
    assert.equal(state.canSubmitNow, true);
    assert.equal(state.completionBlocked, false);
});

test("submission remains allowed through the displayed deadline minute", () => {
    /*
     * What and why this test checks:
     * This preserves the user-facing minute boundary where a 10:00 deadline is still completable until 10:00:59.
     *
     * Passing scenario:
     * When now is within the displayed deadline minute, pastDeadline is false and canSubmitNow is true.
     *
     * Failing scenario:
     * If the inclusive displayed deadline minute regresses, users could miss tasks even though the displayed deadline minute has not ended.
     */
    const deadlineIso = "2026-03-23T10:00:00.000Z";
    const state = getTaskSubmissionWindowState({
        startAtIso: "2026-03-23T09:00:00.000Z",
        deadlineIso,
        now: new Date("2026-03-23T10:00:59.999Z"),
    });

    assert.equal(state.beforeStart, false);
    assert.equal(state.pastDeadline, false);
    assert.equal(state.canSubmitNow, true);
    assert.equal(state.completionBlocked, false);
});

test("submission is blocked after the displayed deadline minute ends", () => {
    /*
     * What and why this test checks:
     * This pins missed processing to the first instant after the displayed deadline minute has elapsed.
     *
     * Passing scenario:
     * When now is exactly 60 seconds after deadline, pastDeadline is true and canSubmitNow is false.
     *
     * Failing scenario:
     * If the comparison drifts later, users could submit after the intended deadline minute.
     */
    const deadlineIso = "2026-03-23T10:00:00.000Z";
    const state = getTaskSubmissionWindowState({
        startAtIso: "2026-03-23T09:00:00.000Z",
        deadlineIso,
        now: new Date("2026-03-23T10:01:00.000Z"),
    });

    assert.equal(state.beforeStart, false);
    assert.equal(state.pastDeadline, true);
    assert.equal(state.canSubmitNow, false);
    assert.equal(state.completionBlocked, true);
});

test("task actions remain available until the displayed deadline minute ends", () => {
    const deadline = new Date("2026-03-23T23:00:00.000Z");

    assert.equal(isWithinInclusiveDeadlineMinute(deadline, new Date("2026-03-23T23:00:00.000Z")), true);
    assert.equal(isWithinInclusiveDeadlineMinute(deadline, new Date("2026-03-23T23:00:59.999Z")), true);
    assert.equal(isWithinInclusiveDeadlineMinute(deadline, new Date("2026-03-23T23:01:00.000Z")), false);
});
