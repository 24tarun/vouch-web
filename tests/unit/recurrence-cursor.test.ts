import assert from "node:assert/strict";
import test from "node:test";
import { isRecurrenceDateAlreadyGenerated } from "../../src/lib/recurrence-cursor";

test("a future initial occurrence prevents the generator from moving the cursor backward", () => {
    assert.equal(isRecurrenceDateAlreadyGenerated("2026-06-29", "2026-06-28"), true);
});

test("the current local date is generated at most once", () => {
    assert.equal(isRecurrenceDateAlreadyGenerated("2026-06-29", "2026-06-29"), true);
});

test("a later local date remains eligible for generation", () => {
    assert.equal(isRecurrenceDateAlreadyGenerated("2026-06-29", "2026-06-30"), false);
    assert.equal(isRecurrenceDateAlreadyGenerated(null, "2026-06-30"), false);
});

test("malformed cursor values fail open instead of permanently blocking a series", () => {
    assert.equal(isRecurrenceDateAlreadyGenerated("not-a-date", "2026-06-30"), false);
});
