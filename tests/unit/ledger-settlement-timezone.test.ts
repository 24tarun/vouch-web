import test from "node:test";
import assert from "node:assert/strict";
import {
    getPreviousLocalMonthPeriod,
    resolveTimeZone,
    shouldCompileNow,
} from "../../src/trigger/ledger-settlement";

test("resolveTimeZone falls back to UTC for invalid timezone", () => {
    assert.equal(resolveTimeZone("Not/A_Real_Zone"), "UTC");
    assert.equal(resolveTimeZone(null), "UTC");
});

test("shouldCompileNow checks local day 3 at local hour 00", () => {
    const berlinCompile = new Date("2026-05-02T22:10:00.000Z"); // 00:10 on May 3 in Berlin
    const berlinNotCompile = new Date("2026-05-02T21:10:00.000Z"); // 23:10 on May 2 in Berlin
    assert.equal(shouldCompileNow(berlinCompile, "Europe/Berlin"), true);
    assert.equal(shouldCompileNow(berlinNotCompile, "Europe/Berlin"), false);
});

test("getPreviousLocalMonthPeriod uses user timezone calendar", () => {
    const date = new Date("2026-01-03T00:05:00.000Z");
    const { period } = getPreviousLocalMonthPeriod(date, "UTC");
    assert.equal(period, "2025-12");
});
