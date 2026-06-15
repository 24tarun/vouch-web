import test from "node:test";
import assert from "node:assert/strict";
import {
    OWNER_TEMP_DELETE_WINDOW_MS,
    canOwnerTemporarilyDelete,
    getOwnerDeleteRemainingMs,
} from "../../src/lib/task-delete-window.ts";

const createdAtIso = "2026-03-23T10:00:00.000Z";
const createdAtMs = new Date(createdAtIso).getTime();

test("owner temp delete window lasts one hour", () => {
    assert.equal(OWNER_TEMP_DELETE_WINDOW_MS, 60 * 60 * 1000);
    assert.equal(getOwnerDeleteRemainingMs(createdAtIso, createdAtMs + (59 * 60 * 1000)), 60 * 1000);
});

test("owner can still delete active task just before one hour expires", () => {
    assert.equal(
        canOwnerTemporarilyDelete(
            { status: "ACTIVE", created_at: createdAtIso },
            createdAtMs + (60 * 60 * 1000) - 1
        ),
        true
    );
});

test("owner can no longer delete task once one hour has elapsed", () => {
    assert.equal(
        canOwnerTemporarilyDelete(
            { status: "ACTIVE", created_at: createdAtIso },
            createdAtMs + (60 * 60 * 1000)
        ),
        false
    );
});
