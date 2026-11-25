import test from "node:test";
import assert from "node:assert/strict";
import { shouldTreatGoogleRevocationFailureAsSuccess } from "../../src/lib/google-calendar/sync.ts";

test("shouldTreatGoogleRevocationFailureAsSuccess returns true for JSON invalid_token", () => {
    const shouldIgnore = shouldTreatGoogleRevocationFailureAsSuccess(
        400,
        '{ "error": "invalid_token", "error_description": "Token is not revocable." }'
    );

    assert.equal(shouldIgnore, true);
});

test("shouldTreatGoogleRevocationFailureAsSuccess returns true for form-encoded invalid_token", () => {
    const shouldIgnore = shouldTreatGoogleRevocationFailureAsSuccess(
        400,
        "error=invalid_token&error_description=Token+is+not+revocable."
    );

    assert.equal(shouldIgnore, true);
});

test("shouldTreatGoogleRevocationFailureAsSuccess returns false for non-invalid_token failures", () => {
    const shouldIgnore = shouldTreatGoogleRevocationFailureAsSuccess(
        400,
        '{ "error": "unauthorized_client", "error_description": "Client is not allowed." }'
    );

    assert.equal(shouldIgnore, false);
});
