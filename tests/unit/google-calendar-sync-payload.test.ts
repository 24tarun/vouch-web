import test from "node:test";
import assert from "node:assert/strict";
import { buildGoogleEventPayload } from "../../src/lib/google-calendar/sync.ts";

test("buildGoogleEventPayload uses start_at + deadline(end) for new event rows", () => {
    /*
     * What and why this test checks:
     * New event rows persist start in google_event_start_at and end in deadline, so sync payload must honor that model.
     *
     * Passing scenario:
     * Payload start equals google_event_start_at and payload end equals deadline.
     *
     * Failing scenario:
     * If payload uses deadline as start, synced events shift earlier/later and violate end-as-deadline semantics.
     */
    const payload = buildGoogleEventPayload({
        id: "task-1",
        title: "office work",
        description: "focus block",
        deadline: "2026-03-17T16:00:00.000Z",
        google_event_start_at: "2026-03-17T11:00:00.000Z",
        google_event_color_id: "3",
    });

    assert.equal(payload.start?.dateTime, "2026-03-17T11:00:00.000Z");
    assert.equal(payload.end?.dateTime, "2026-03-17T16:00:00.000Z");
    assert.equal(payload.colorId, "3");
});

test("buildGoogleEventPayload falls back to default duration when no explicit start exists", () => {
    /*
     * What and why this test checks:
     * Deadline is now the only due-time source, and legacy end timestamps are ignored in payload shaping.
     *
     * Passing scenario:
     * Payload start falls back to deadline and payload end uses default duration after start.
     *
     * Failing scenario:
     * If fallback regresses to a legacy field, payload behavior drifts from the new deadline-only contract.
     */
    const payload = buildGoogleEventPayload({
        id: "task-legacy",
        title: "legacy block",
        description: null,
        deadline: "2026-03-17T11:00:00.000Z",
        google_event_start_at: null,
        google_event_color_id: null,
    });

    assert.equal(payload.start?.dateTime, "2026-03-17T11:00:00.000Z");
    assert.equal(payload.end?.dateTime, "2026-03-17T12:00:00.000Z");
});
