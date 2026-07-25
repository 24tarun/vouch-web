import test from "node:test";
import assert from "node:assert/strict";
import { TextDecoder, TextEncoder } from "node:util";
import { JSDOM } from "jsdom";
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { ActivityEventBadge, TaskStatusBadge } from "../../src/design-system/statuspills";

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

test("activity event badge renders undo completion as a first-class timeline label", () => {
    const view = render(<ActivityEventBadge eventType="UNDO_COMPLETE" />);

    /*
     * What and why this test checks:
     * This locks the shared activity-badge contract for undo completion so any timeline that renders
     * task events through ActivityEventBadge shows an explicit, intentional label for the event.
     *
     * Passing scenario:
     * Rendering the badge for UNDO_COMPLETE produces a visible `UNDO COMPLETE` label.
     *
     * Failing scenario:
     * If the explicit label mapping disappears, downstream timelines regress to implicit fallback text
     * or omit the event semantics the settings activity view expects.
     */
    assert.ok(view.getByText("UNDO COMPLETE"));
});

test("surrendered task and activity badges use the missed failure colors", () => {
    const failureClasses = ["bg-red-500/10", "text-red-500", "border-red-500/30"];
    const renderBadge = (element: React.ReactNode) => {
        const { container } = render(element);
        return container.querySelector<HTMLElement>('[data-slot="badge"]');
    };
    const badges = [
        renderBadge(<TaskStatusBadge status="MISSED" />),
        renderBadge(<TaskStatusBadge status="SURRENDERED" />),
        renderBadge(<ActivityEventBadge eventType="DEADLINE_MISSED" />),
        renderBadge(<ActivityEventBadge eventType="SURRENDER" />),
    ];

    for (const badge of badges) {
        assert.ok(badge);
        for (const className of failureClasses) {
            assert.ok(badge.classList.contains(className));
        }
    }
});
