import test from "node:test";
import assert from "node:assert/strict";
import { TextDecoder, TextEncoder } from "node:util";
import { JSDOM } from "jsdom";
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { TaskDetailStatsStrip } from "../../src/app/(app)/tasks/[id]/task-detail/sections/task-detail-stats-strip";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
const globalAny = globalThis as typeof globalThis & {
    window: Window & typeof globalThis;
    document: Document;
    navigator: Navigator;
    HTMLElement: typeof HTMLElement;
    Node: typeof Node;
    TextEncoder: typeof TextEncoder;
    TextDecoder: typeof TextDecoder;
    IS_REACT_ACT_ENVIRONMENT: boolean;
};

globalAny.window = dom.window as unknown as Window & typeof globalThis;
globalAny.document = dom.window.document;
Object.defineProperty(globalAny, "navigator", {
    value: dom.window.navigator,
    configurable: true,
});
globalAny.HTMLElement = dom.window.HTMLElement;
globalAny.Node = dom.window.Node;
globalAny.TextEncoder = TextEncoder as unknown as typeof globalAny.TextEncoder;
globalAny.TextDecoder = TextDecoder as unknown as typeof globalAny.TextDecoder;
globalAny.IS_REACT_ACT_ENVIRONMENT = true;

test.afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
});

function renderStrip(
    canEditFutureRepetitions: boolean,
    highlightedFields = new Set<"deadline" | "failureCost" | "voucher" | "requiresProof">()
) {
    return render(
        <TaskDetailStatsStrip
            deadline={new Date("2026-07-25T08:00:00.000Z")}
            status="ACTIVE"
            formattedFailureCost="€7.00"
            voucherLabel="Self"
            totalPomoSeconds={0}
            sessionCount={0}
            proofRequired
            canEditFutureRepetitions={canEditFutureRepetitions}
            highlightedFields={highlightedFields}
            onEditFutureSetting={() => undefined}
        />
    );
}

test("proof required is always a first-class task detail row", () => {
    const view = renderStrip(false);
    assert.ok(view.getByText("Proof Required"));
    assert.ok(view.getByText("True"));
    assert.equal(view.queryAllByRole("button").length, 0);
});

test("paused repetitions expose one field-level edit action per editable future setting", () => {
    const view = renderStrip(true);
    assert.ok(view.getByText("€7.00"));
    assert.ok(view.getByText("Self"));
    assert.ok(view.getByText("True"));
    assert.equal(view.queryByText(/future/i), null);
    assert.ok(view.getByRole("button", { name: "Edit deadline for future repetitions" }));
    assert.ok(view.getByRole("button", { name: "Edit failure cost for future repetitions" }));
    assert.ok(view.getByRole("button", { name: "Edit voucher for future repetitions" }));
    assert.ok(view.getByRole("button", { name: "Edit proof requirement for future repetitions" }));
});

test("only successfully edited values are highlighted in place", () => {
    const view = renderStrip(true, new Set(["failureCost", "voucher"]));

    assert.equal(view.getByText("€7.00").getAttribute("data-highlighted"), "true");
    assert.equal(view.getByText("Self").getAttribute("data-highlighted"), "true");
    assert.equal(view.getByText("True").getAttribute("data-highlighted"), null);
});

test("edited styling is removed after repetitions resume", () => {
    const view = renderStrip(false, new Set(["deadline"]));

    assert.equal(
        view.container.querySelector('[data-highlighted="true"]'),
        null
    );
});
