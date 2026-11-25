import test from "node:test";
import assert from "node:assert/strict";
import {
    getTaskSubmissionWindowState,
    isTaskCompletionLocked,
    isWithinInclusiveDeadlineMinute,
    wasProofStagedBeforeCompletionLock,
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

test("completed waiting states lock exactly after the inclusive deadline minute", () => {
    const deadlineIso = "2026-03-23T23:00:00.000Z";

    for (const status of ["AWAITING_VOUCHER", "AWAITING_AI", "MARKED_COMPLETE"] as const) {
        assert.equal(
            isTaskCompletionLocked(status, deadlineIso, new Date("2026-03-23T23:00:59.999Z")),
            false,
            `${status} should remain editable during the displayed deadline minute`
        );
        assert.equal(
            isTaskCompletionLocked(status, deadlineIso, new Date("2026-03-23T23:01:00.000Z")),
            true,
            `${status} should lock at the first instant after the displayed deadline minute`
        );
    }

    assert.equal(
        isTaskCompletionLocked("AWAITING_USER", deadlineIso, new Date("2026-03-23T23:01:00.000Z")),
        false
    );
});

test("proof staging records whether an upload was authorized before the lock", () => {
    const deadlineIso = "2026-03-23T23:00:00.000Z";

    assert.equal(wasProofStagedBeforeCompletionLock(deadlineIso, "2026-03-23T23:00:59.999Z"), true);
    assert.equal(wasProofStagedBeforeCompletionLock(deadlineIso, "2026-03-23T23:01:00.000Z"), false);
    assert.equal(wasProofStagedBeforeCompletionLock(deadlineIso, "invalid"), false);
});
