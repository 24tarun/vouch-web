import test from "node:test";
import assert from "node:assert/strict";
import {
    extractWeekdayDateTokens,
    resolveUpcomingWeekdayDate,
} from "../../src/lib/task-title-weekday";

test("weekday parser recognizes short and long monday tokens", () => {
    const shortToken = extractWeekdayDateTokens("finish review mon");
    const longToken = extractWeekdayDateTokens("finish review monday");

    assert.equal(shortToken.length, 1);
    assert.equal(shortToken[0].weekday, 1);
    assert.equal(longToken.length, 1);
    assert.equal(longToken[0].weekday, 1);
});

test("upcoming monday from Saturday March 14, 2026 resolves to March 16, 2026", () => {
    const saturday = new Date(2026, 2, 14, 10, 30, 0, 0);
    const resolved = resolveUpcomingWeekdayDate(1, saturday);

    assert.equal(resolved.getFullYear(), 2026);
    assert.equal(resolved.getMonth(), 2);
    assert.equal(resolved.getDate(), 16);
    assert.equal(resolved.getDay(), 1);
});

test("weekday resolution keeps same day when token matches today", () => {
    const monday = new Date(2026, 2, 16, 9, 0, 0, 0);
    const resolved = resolveUpcomingWeekdayDate(1, monday);

    assert.equal(resolved.getFullYear(), 2026);
    assert.equal(resolved.getMonth(), 2);
    assert.equal(resolved.getDate(), 16);
    assert.equal(resolved.getDay(), 1);
});

