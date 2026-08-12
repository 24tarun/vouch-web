import test from "node:test";
import assert from "node:assert/strict";
import { describePomoConflict, describePomoOwner } from "../../src/lib/pomodoro-owner.ts";

test("Pomodoro conflicts identify the task, state, and Mac buddy", () => {
    const message = describePomoConflict({
        id: "session-1",
        status: "PAUSED",
        task: { title: "Write release notes" },
        owner: {
            platform: "macos",
            client_name: "vouch-pomo-buddy-mac",
            device_label: "Tarun’s MacBook",
        },
    });

    assert.equal(
        message,
        "A Pomodoro for “Write release notes” is already paused on Vouch Pomo Buddy on Tarun’s MacBook. End it there before starting another."
    );
});

test("web owner labels do not expose the full user agent", () => {
    assert.equal(
        describePomoOwner({
            platform: "web",
            device_label: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
        }),
        "Safari on Mac"
    );
});

test("unknown legacy owners remain understandable blockers", () => {
    assert.equal(
        describePomoConflict({ id: "legacy", status: "ACTIVE", task: null, owner: null }),
        "A Pomodoro for “another task” is already running on another Vouch client. End it there before starting another."
    );
});
