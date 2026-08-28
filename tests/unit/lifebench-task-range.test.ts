import assert from "node:assert/strict";
import test from "node:test";
import {
    LIFEBENCH_MAX_RANGE_MS,
    parseLifebenchTaskRange,
} from "../../src/lib/lifebench/task-range";

test("parses and normalizes a half-open Lifebench task range", () => {
    const result = parseLifebenchTaskRange(
        new URLSearchParams({
            from: "2026-08-01T00:00:00+02:00",
            to: "2026-09-01T00:00:00+02:00",
        })
    );

    assert.deepEqual(result, {
        range: {
            from: "2026-07-31T22:00:00.000Z",
            to: "2026-08-31T22:00:00.000Z",
        },
        error: null,
    });
});

test("requires both range boundaries with explicit timezone information", () => {
    assert.match(
        parseLifebenchTaskRange(
            new URLSearchParams({ from: "2026-08-01T00:00:00Z" })
        ).error ?? "",
        /Both from and to are required/
    );
    assert.match(
        parseLifebenchTaskRange(
            new URLSearchParams({
                from: "2026-08-01",
                to: "2026-09-01",
            })
        ).error ?? "",
        /valid ISO 8601 timestamps/
    );
});

test("rejects reversed and overly broad ranges", () => {
    assert.equal(
        parseLifebenchTaskRange(
            new URLSearchParams({
                from: "2026-09-01T00:00:00Z",
                to: "2026-08-01T00:00:00Z",
            })
        ).error,
        "to must be later than from."
    );

    const from = new Date("2025-01-01T00:00:00Z");
    const to = new Date(from.getTime() + LIFEBENCH_MAX_RANGE_MS + 1);
    assert.equal(
        parseLifebenchTaskRange(
            new URLSearchParams({
                from: from.toISOString(),
                to: to.toISOString(),
            })
        ).error,
        "The requested range cannot be longer than 366 days."
    );
});
