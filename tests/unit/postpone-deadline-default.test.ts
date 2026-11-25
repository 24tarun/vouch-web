import test from "node:test";
import assert from "node:assert/strict";
import { getDefaultDeadlineDraftValue } from "../../src/components/PostponeDeadlineDialog";
import { toDateTimeLocalValue } from "../../src/lib/datetime-local";

test("postpone default uses current deadline plus one day when the existing deadline is valid", () => {
    const existingDeadlineIso = "2026-03-13T20:00:00.000Z";
    const expected = toDateTimeLocalValue(
        new Date(new Date(existingDeadlineIso).getTime() + 24 * 60 * 60 * 1000)
    );

    assert.equal(getDefaultDeadlineDraftValue(existingDeadlineIso), expected);
});

test("postpone default falls back to now plus one day when the existing deadline is missing or invalid", () => {
    const fixedNowMs = Date.UTC(2026, 2, 13, 14, 0, 0, 0);
    const originalDateNow = Date.now;
    Date.now = () => fixedNowMs;

    try {
        const expected = toDateTimeLocalValue(new Date(fixedNowMs + 24 * 60 * 60 * 1000));

        assert.equal(getDefaultDeadlineDraftValue(null), expected);
        assert.equal(getDefaultDeadlineDraftValue("invalid-date"), expected);
    } finally {
        Date.now = originalDateNow;
    }
});
