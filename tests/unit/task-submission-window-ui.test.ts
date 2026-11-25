import test from "node:test";
import assert from "node:assert/strict";
import { getTaskSubmissionWindowState } from "../../src/lib/task-submission-window.ts";

test("UI completion state is disabled before start time", () => {
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
    const deadlineIso = "2026-03-23T11:00:00.000Z";
    const state = getTaskSubmissionWindowState({
        startAtIso: "2026-03-23T09:00:00.000Z",
        deadlineIso,
        now: new Date("2026-03-23T11:01:00.000Z"),
    });

    assert.equal(state.pastDeadline, true);
    assert.equal(state.completionBlocked, true);
});
