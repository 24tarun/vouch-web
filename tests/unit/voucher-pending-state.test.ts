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

    assert.equal(preferServer, true);
});
