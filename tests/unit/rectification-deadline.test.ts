import test from "node:test";
import assert from "node:assert/strict";
import { getRectificationAutoAt } from "@/lib/rectification/deadline";

test("mid-month requests wait until the owner's local month boundary", () => {
    const submitted = new Date("2026-07-15T10:00:00.000Z");
    assert.equal(
        getRectificationAutoAt(submitted, "Europe/Berlin").toISOString(),
        "2026-07-31T22:00:00.000Z",
    );
});

test("late-month requests retain a full 48 hour review window", () => {
    const submitted = new Date("2026-07-31T21:58:00.000Z"); // 23:58 in Berlin
    assert.equal(
        getRectificationAutoAt(submitted, "Europe/Berlin").toISOString(),
        "2026-08-02T21:58:00.000Z",
    );
});

test("the 48 hour guarantee is elapsed time across a DST boundary", () => {
    const submitted = new Date("2026-11-01T03:58:00.000Z"); // 23:58 Oct 31 in New York
    assert.equal(
        getRectificationAutoAt(submitted, "America/New_York").toISOString(),
        "2026-11-03T03:58:00.000Z",
    );
});

test("resubmission receives a newly calculated 48 hour guarantee", () => {
    const original = new Date("2026-07-30T10:00:00.000Z");
    const resubmitted = new Date("2026-07-31T21:58:00.000Z");
    assert.ok(
        getRectificationAutoAt(resubmitted, "Europe/Berlin").getTime()
        > getRectificationAutoAt(original, "Europe/Berlin").getTime(),
    );
});
