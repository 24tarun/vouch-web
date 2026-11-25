import test from "node:test";
import assert from "node:assert/strict";
import { mapGoogleAuthFailureToReconnectMessage } from "../../src/lib/google-calendar/sync.ts";

test("mapGoogleAuthFailureToReconnectMessage maps revoked-refresh-token errors to reconnect guidance", () => {
    const message = mapGoogleAuthFailureToReconnectMessage(
        new Error("Token has been expired or revoked.")
    );

    assert.equal(
        message,
        "Google Calendar connection expired. Please disconnect and reconnect Google Calendar."
    );
});

test("mapGoogleAuthFailureToReconnectMessage keeps non-auth errors unmapped", () => {
    const message = mapGoogleAuthFailureToReconnectMessage(
        new Error("Network timeout while loading calendars.")
    );

    assert.equal(message, null);
});
