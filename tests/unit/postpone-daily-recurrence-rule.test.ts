import test from "node:test";
import assert from "node:assert/strict";
import {
    canPostponeDailyRecurringTaskToDeadline,
    shouldRestrictDailyPostponeToSameRuleDay,
} from "../../src/lib/postpone-daily-recurrence";

test("daily recurrence allows postponing within the same rule-local day", () => {
    const currentDeadline = new Date("2026-03-24T09:00:00.000Z");
    const proposedDeadline = new Date("2026-03-24T18:30:00.000Z");

    assert.equal(
        canPostponeDailyRecurringTaskToDeadline(currentDeadline, proposedDeadline, "Europe/Berlin"),
        true
    );
});

test("daily recurrence blocks postponing into a different rule-local day", () => {
    const currentDeadline = new Date("2026-03-24T20:00:00.000Z");
    const proposedDeadline = new Date("2026-03-25T08:30:00.000Z");

    assert.equal(
        canPostponeDailyRecurringTaskToDeadline(currentDeadline, proposedDeadline, "America/Los_Angeles"),
        false
    );
});

test("timezone boundary allows postpone when UTC day changes but rule-local day is still the same", () => {
    const currentDeadline = new Date("2026-03-24T23:30:00.000Z");
    const proposedDeadline = new Date("2026-03-25T05:30:00.000Z");

    assert.equal(
        canPostponeDailyRecurringTaskToDeadline(currentDeadline, proposedDeadline, "America/Los_Angeles"),
        true
    );
});

test("non-daily recurrence does not activate the same-day postpone restriction", () => {
    assert.equal(shouldRestrictDailyPostponeToSameRuleDay({ frequency: "WEEKLY" }), false);
    assert.equal(shouldRestrictDailyPostponeToSameRuleDay({ frequency: "DAILY" }), true);
});

test("invalid or missing timezone falls back to UTC day comparison", () => {
    const currentDeadline = new Date("2026-03-24T23:30:00.000Z");
    const proposedDeadline = new Date("2026-03-25T00:30:00.000Z");

    assert.equal(
        canPostponeDailyRecurringTaskToDeadline(currentDeadline, proposedDeadline, "Invalid/Timezone"),
        false
    );
    assert.equal(
        canPostponeDailyRecurringTaskToDeadline(currentDeadline, proposedDeadline, null),
        false
    );
});
