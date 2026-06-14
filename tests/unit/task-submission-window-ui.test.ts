import test from "node:test";
import assert from "node:assert/strict";
import { getTaskSubmissionWindowState } from "../../src/lib/task-submission-window.ts";

test("UI completion state is disabled before start time", () => {
    /*
     * What and why this test checks:
     * This verifies the UI-facing completion flag turns off the Mark Complete action before the start boundary.
     *
     * Passing scenario:
     * With now earlier than start and before deadline, completionBlocked is true.
     *
     * Failing scenario:
     * If completionBlocked is false here, completion controls may render enabled before the allowed start interval.
     */
    const state = getTaskSubmissionWindowState({
        startAtIso: "2026-03-23T10:00:00.000Z",
        deadlineIso: "2026-03-23T11:00:00.000Z",
        isStrict: true,
        now: new Date("2026-03-23T09:30:00.000Z"),
    });

    assert.equal(state.beforeStart, true);
    assert.equal(state.completionBlocked, true);
});

test("UI completion state becomes enabled exactly at start time", () => {
    /*
     * What and why this test checks:
     * This ensures the completion control transitions to enabled at the exact start boundary, not after it.
     *
     * Passing scenario:
     * At the same timestamp as start and with future deadline, completionBlocked is false.
     *
     * Failing scenario:
     * If this remains blocked, UI controls would show disabled longer than the configured interval requires.
     */
    const atStartIso = "2026-03-23T10:00:00.000Z";
    const state = getTaskSubmissionWindowState({
        startAtIso: atStartIso,
        deadlineIso: "2026-03-23T11:00:00.000Z",
        now: new Date(atStartIso),
    });

    assert.equal(state.beforeStart, false);
    assert.equal(state.completionBlocked, false);
});

test("UI completion state stays enabled through the displayed deadline minute", () => {
    /*
     * What and why this test checks:
     * This confirms completion controls stay enabled during the 60-second displayed deadline minute.
     *
     * Passing scenario:
     * When now is within 60 seconds of deadline, pastDeadline is false and completionBlocked is false.
     *
     * Failing scenario:
     * If completionBlocked becomes true too early, the UI can incorrectly block valid completion actions.
     */
    const deadlineIso = "2026-03-23T11:00:00.000Z";
    const state = getTaskSubmissionWindowState({
        startAtIso: "2026-03-23T09:00:00.000Z",
        deadlineIso,
        now: new Date("2026-03-23T11:00:59.999Z"),
    });

    assert.equal(state.pastDeadline, false);
    assert.equal(state.completionBlocked, false);
});

test("UI completion state is disabled after the displayed deadline minute ends", () => {
    /*
     * What and why this test checks:
     * This confirms completion controls disable once the displayed deadline minute has elapsed.
     *
     * Passing scenario:
     * When now is exactly 60 seconds after deadline, pastDeadline is true and completionBlocked is true.
     *
     * Failing scenario:
     * If completionBlocked is false after the inclusive displayed deadline minute, the UI can incorrectly permit late submission actions.
     */
    const deadlineIso = "2026-03-23T11:00:00.000Z";
    const state = getTaskSubmissionWindowState({
        startAtIso: "2026-03-23T09:00:00.000Z",
        deadlineIso,
        now: new Date("2026-03-23T11:01:00.000Z"),
    });

    assert.equal(state.pastDeadline, true);
    assert.equal(state.completionBlocked, true);
});
