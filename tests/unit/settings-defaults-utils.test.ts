import test from "node:test";
import assert from "node:assert/strict";

import {
    buildDefaultsFormData,
    clampFailureCostToCurrencyBounds,
    validateDefaultsState,
} from "../../src/app/(app)/settings/settings/utils/defaults";
import { getFailureCostBounds, isValidFailureCostCents } from "../../src/lib/currency";

test("failure-cost bounds use the requested currency-specific minimums and increments", () => {
    const eur = getFailureCostBounds("EUR");
    const usd = getFailureCostBounds("USD");
    const inr = getFailureCostBounds("INR");

    assert.deepEqual(
        { minMajor: eur.minMajor, step: eur.step, minCents: eur.minCents },
        { minMajor: 0.25, step: 0.25, minCents: 25 }
    );
    assert.deepEqual(
        { minMajor: usd.minMajor, step: usd.step, minCents: usd.minCents },
        { minMajor: 0.25, step: 0.25, minCents: 25 }
    );
    assert.deepEqual(
        { minMajor: inr.minMajor, step: inr.step, minCents: inr.minCents },
        { minMajor: 10, step: 10, minCents: 1000 }
    );
    assert.equal(isValidFailureCostCents(25, eur), true);
    assert.equal(isValidFailureCostCents(30, eur), false);
    assert.equal(isValidFailureCostCents(1000, inr), true);
    assert.equal(isValidFailureCostCents(1500, inr), false);
});

test("clampFailureCostToCurrencyBounds clamps out-of-range values", () => {
    // What/why: keeps client-side defaults clamped to server-aligned currency bounds.
    // Passing scenario: value above USD max is clamped to max.
    assert.equal(clampFailureCostToCurrencyBounds("999999", "USD"), "100.00");
    // Failing scenario: non-numeric values are coerced safely, not propagated as invalid strings.
    assert.equal(clampFailureCostToCurrencyBounds("abc", "USD"), "0.25");
    assert.equal(clampFailureCostToCurrencyBounds("0.30", "EUR"), "0.25");
    assert.equal(clampFailureCostToCurrencyBounds("15", "INR"), "20");
});

test("buildDefaultsFormData writes expected server keys", () => {
    // What/why: verifies extracted payload builder preserves server action contract keys.
    const form = buildDefaultsFormData({
        defaultPomoDurationMinutes: "25",
        defaultEventDurationMinutes: "60",
        defaultTaskDeadlineTime: "23:00",
        defaultFailureCostEuros: "1.00",
        effectiveDefaultVoucherId: "voucher-1",
        deadlineOneHourWarningEnabled: true,
        deadlineFinalWarningEnabled: true,
        deadlineDueWarningEnabled: true,
        voucherCanViewActiveTasksEnabled: false,
        alwaysShowActiveTasks: true,
        defaultRequiresProofForAllTasks: false,
        autoSubmitAfterProofUpload: true,
        webNotificationsEnabled: false,
        currency: "EUR",
        timeZone: "UTC",
        timeZoneUserSet: true,
        charityEnabled: false,
        selectedCharityId: "",
    });
    // Passing scenario: required fields are present with expected values.
    assert.equal(form.get("defaultPomoDurationMinutes"), "25");
    assert.equal(form.get("defaultTaskDeadlineTime"), "23:00");
    assert.equal(form.get("currency"), "EUR");
    assert.equal(form.get("autoSubmitAfterProofUpload"), "true");
    assert.equal(form.get("alwaysShowActiveTasks"), "true");
    assert.equal(form.get("deadlineDueWarningEnabled"), "true");
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
            defaultTaskDeadlineTime: "23:00",
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
            defaultTaskDeadlineTime: "23:00",
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
