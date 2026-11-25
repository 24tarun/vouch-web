import test from "node:test";
import assert from "node:assert/strict";
import { createAutoLockController, shouldSuppressAutoLock } from "../../src/lib/auto-lock.ts";

function createAutoLockAdapterMock() {
    const calls: Array<"suppress" | "allow"> = [];
    return {
        calls,
        adapter: {
            suppressAutoLock: async () => {
                calls.push("suppress");
            },
            allowAutoLock: async () => {
                calls.push("allow");
            },
        },
    };
}

test("ACTIVE + expanded suppresses auto-lock", () => {
    assert.equal(shouldSuppressAutoLock("ACTIVE", false), true);
});

test("ACTIVE + minimized allows normal auto-lock", () => {
    assert.equal(shouldSuppressAutoLock("ACTIVE", true), false);
});

test("PAUSED or ended sessions allow normal auto-lock in expanded mode", () => {
    assert.equal(shouldSuppressAutoLock("PAUSED", false), false);
    assert.equal(shouldSuppressAutoLock("COMPLETED", false), false);
});

test("transition expanded -> minimized while ACTIVE calls allow once", async () => {
    const mock = createAutoLockAdapterMock();
    const controller = createAutoLockController(mock.adapter);

    await controller.setAutoLockSuppressed(true);
    await controller.setAutoLockSuppressed(false);
    await controller.setAutoLockSuppressed(false);

    assert.equal(mock.calls.filter((call) => call === "allow").length, 1);
});

test("transition minimized -> expanded while ACTIVE calls suppress once", async () => {
    const mock = createAutoLockAdapterMock();
    const controller = createAutoLockController(mock.adapter);

    await controller.setAutoLockSuppressed(false);
    await controller.setAutoLockSuppressed(true);
    await controller.setAutoLockSuppressed(true);

    assert.equal(mock.calls.filter((call) => call === "suppress").length, 1);
});

test("cleanup after enabled state always releases auto-lock", async () => {
    const mock = createAutoLockAdapterMock();
    const controller = createAutoLockController(mock.adapter);

    await controller.setAutoLockSuppressed(true);
    await controller.cleanup();

    assert.equal(mock.calls.includes("allow"), true);
});
