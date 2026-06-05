import test from "node:test";
import assert from "node:assert/strict";
import {
    deriveVoucherPendingDeadline,
    getVoucherPendingDisplayType,
    isVoucherPendingActionable,
    shouldPreferServerPendingTask,
} from "../../src/lib/voucher-pending-state";

test("review states derive awaiting display metadata consistently", () => {
    const markedCompletedAt = "2026-06-05T08:00:00.000Z";
    const derivedDeadline = deriveVoucherPendingDeadline({
        status: "MARKED_COMPLETE",
        deadline: "2026-06-05T23:59:00.000Z",
        voucher_response_deadline: null,
        marked_completed_at: markedCompletedAt,
    });

    /*
     * What and why this test checks:
     * This locks the shared pending-state mapping used by both the server payload and the friends page client.
     *
     * Passing scenario:
     * Review states render as awaiting-voucher, stay actionable, and derive a voucher deadline from
     * marked_completed_at when an explicit review deadline is not present.
     *
     * Failing scenario:
     * If any of these shared rules drift, the friends page can show the wrong badge or hide the review buttons.
     */
    assert.equal(getVoucherPendingDisplayType("MARKED_COMPLETE"), "AWAITING_VOUCHER");
    assert.equal(isVoucherPendingActionable("MARKED_COMPLETE"), true);
    assert.ok(derivedDeadline);
    const derivedDeadlineDate = new Date(derivedDeadline);
    assert.equal(derivedDeadlineDate.getUTCDate(), 7);
    assert.equal(derivedDeadlineDate.getMinutes(), 59);
    assert.equal(derivedDeadlineDate.getSeconds(), 59);
    assert.equal(derivedDeadlineDate.getMilliseconds(), 999);
});

test("fresh server awaiting state beats a stale local active copy", () => {
    const preferServer = shouldPreferServerPendingTask(
        {
            status: "ACTIVE",
            updated_at: "2026-06-05T09:00:00.000Z",
        },
        {
            status: "AWAITING_VOUCHER",
            updated_at: "2026-06-05T08:30:00.000Z",
        }
    );

    /*
     * What and why this test checks:
     * This captures the exact regression from the friends page: once the authoritative payload says the task is
     * awaiting voucher review, we must not keep rendering a stale active copy just because the client still has it.
     *
     * Passing scenario:
     * The server task wins and the UI can show the vouch buttons again.
     *
     * Failing scenario:
     * If the stale active task keeps winning, the friends page shows `ACTIVE` and hides the action buttons.
     */
    assert.equal(preferServer, true);
});

test("newer server active state can still replace an older local review state", () => {
    const preferServer = shouldPreferServerPendingTask(
        {
            status: "AWAITING_VOUCHER",
            updated_at: "2026-06-05T08:00:00.000Z",
        },
        {
            status: "ACTIVE",
            updated_at: "2026-06-05T09:00:00.000Z",
        }
    );

    /*
     * What and why this test checks:
     * This preserves the opposite transition too, such as undo-complete or other legitimate returns to an
     * active state, as long as the server payload is actually newer.
     *
     * Passing scenario:
     * A newer active server payload replaces the stale awaiting copy.
     *
     * Failing scenario:
     * If review states always win forever, the friends page could get stuck showing review actions after a revert.
     */
    assert.equal(preferServer, true);
});
