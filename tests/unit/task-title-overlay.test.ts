import test from "node:test";
import assert from "node:assert/strict";
import { shouldRenderTaskTitleOverlay } from "../../src/lib/task-title-overlay.ts";

test("plain titles keep native input text visible", () => {
    assert.equal(
        shouldRenderTaskTitleOverlay("Screen", [{ className: "text-white" }]),
        false
    );
});

test("highlighted or autocompleted titles still use the overlay", () => {
    assert.equal(
        shouldRenderTaskTitleOverlay("plan -event", [{ className: "text-orange-400" }]),
        true
    );
    assert.equal(
        shouldRenderTaskTitleOverlay("pla", [{ className: "text-white" }], "n"),
        true
    );
});
