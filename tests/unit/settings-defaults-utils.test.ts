import test from "node:test";
import assert from "node:assert/strict";

import {
    buildDefaultsFormData,
    clampFailureCostToCurrencyBounds,
    validateDefaultsState,
} from "../../src/app/(app)/settings/settings/utils/defaults";

test("clampFailureCostToCurrencyBounds clamps out-of-range values", () => {
    // What/why: keeps client-side defaults clamped to server-aligned currency bounds.
    // Passing scenario: value above USD max is clamped to max.
    assert.equal(clampFailureCostToCurrencyBounds("999999", "USD"), "100.00");
    // Failing scenario: non-numeric values are coerced safely, not propagated as invalid strings.
    assert.equal(clampFailureCostToCurrencyBounds("abc", "USD"), "1.00");
});

test("buildDefaultsFormData writes expected server keys", () => {
    // What/why: verifies extracted payload builder preserves server action contract keys.
    const form = buildDefaultsFormData({
        defaultPomoDurationMinutes: "25",
        defaultEventDurationMinutes: "60",
        defaultFailureCostEuros: "1.00",
        effectiveDefaultVoucherId: "voucher-1",
        deadlineOneHourWarningEnabled: true,
        deadlineFinalWarningEnabled: true,
        voucherCanViewActiveTasksEnabled: false,
        defaultRequiresProofForAllTasks: false,
        mobileNotificationsEnabled: false,
        currency: "EUR",
        timeZone: "UTC",
        timeZoneUserSet: true,
        charityEnabled: false,
        selectedCharityId: "",
    });
    // Passing scenario: required fields are present with expected values.
    assert.equal(form.get("defaultPomoDurationMinutes"), "25");
    assert.equal(form.get("currency"), "EUR");
    // Failing scenario: a missing contract key would return null and fail this assertion.
    assert.notEqual(form.get("defaultVoucherId"), null);
});

test("validateDefaultsState blocks invalid timezone and accepts valid payload", () => {
    // What/why: protects autosave from sending invalid intermediate settings.
    // Passing scenario: valid inputs return no error.
    assert.equal(
        validateDefaultsState({
            defaultPomoDurationMinutes: "25",
            defaultEventDurationMinutes: "60",
            defaultFailureCostEuros: "1.00",
            currency: "EUR",
            currencySymbol: "€",
            timeZone: "UTC",
            timeZoneOptions: ["UTC", "Europe/Berlin"],
            charityEnabled: false,
            selectedCharityId: "",
            selectedCharity: null,
        }),
        null
    );
    // Failing scenario: invalid timezone should return a blocking validation message.
    assert.equal(
        validateDefaultsState({
            defaultPomoDurationMinutes: "25",
            defaultEventDurationMinutes: "60",
            defaultFailureCostEuros: "1.00",
            currency: "EUR",
            currencySymbol: "€",
            timeZone: "Mars/Phobos",
            timeZoneOptions: ["UTC", "Europe/Berlin"],
            charityEnabled: false,
            selectedCharityId: "",
            selectedCharity: null,
        }),
        "Timezone is invalid."
    );
});
