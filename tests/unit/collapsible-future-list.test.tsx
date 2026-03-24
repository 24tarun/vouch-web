import test from "node:test";
import assert from "node:assert/strict";
import { TextDecoder, TextEncoder } from "node:util";
import { JSDOM } from "jsdom";
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { CollapsibleFutureList } from "../../src/components/CollapsibleFutureList";
import type { Task } from "../../src/lib/types";

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
    window.sessionStorage.clear();
});

function toLocalIso(
    year: number,
    monthIndex: number,
    day: number,
    hours: number,
    minutes: number,
    seconds = 0,
    milliseconds = 0
): string {
    return new Date(year, monthIndex, day, hours, minutes, seconds, milliseconds).toISOString();
}

function buildTask(id: string, title: string, deadlineIso: string): Task {
    return {
        id,
        user_id: "user-1",
        voucher_id: "user-1",
        title,
        description: null,
        failure_cost_cents: 100,
        required_pomo_minutes: null,
        deadline: deadlineIso,
        status: "ACTIVE",
        postponed_at: null,
        marked_completed_at: null,
        voucher_response_deadline: null,
        recurrence_rule_id: null,
        google_sync_for_task: false,
        created_at: toLocalIso(2026, 5, 1, 9, 0),
        updated_at: toLocalIso(2026, 5, 1, 9, 0),
    };
}

function renderFutureAccordion(tasks: Task[]) {
    return render(
        <CollapsibleFutureList
            tasks={tasks}
            renderTask={(task) => (
                <div key={task.id} data-testid={`future-task-${task.id}`}>
                    {task.title}
                </div>
            )}
        />
    );
}

test("Future accordion starts collapsed when no saved session state exists", () => {
    /*
     * What and why this test checks:
     * This verifies the default behavior is closed when no prior session preference exists.
     *
     * Passing scenario:
     * The Future header renders, its aria-expanded is false, and row content is hidden initially.
     *
     * Failing scenario:
     * If the accordion starts open by default, it no longer matches Past-style manual expand behavior.
     */
    const view = renderFutureAccordion([buildTask("a", "Future A", toLocalIso(2026, 5, 3, 9, 0))]);

    const toggle = view.getByRole("button", { name: "Future" });
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(view.queryByText("Future A"), null);
});

test("Future accordion opens when header is clicked", () => {
    /*
     * What and why this test checks:
     * This validates the user interaction path to manually inspect future-due tasks.
     *
     * Passing scenario:
     * Clicking the Future button expands the panel and renders the task row content.
     *
     * Failing scenario:
     * If click does not open the panel, future tasks are inaccessible from the dashboard.
     */
    const view = renderFutureAccordion([buildTask("a", "Future A", toLocalIso(2026, 5, 3, 9, 0))]);

    fireEvent.click(view.getByRole("button", { name: "Future" }));

    assert.ok(view.getByText("Future A"));
    assert.equal(
        view.getByRole("button", { name: "Future" }).getAttribute("aria-expanded"),
        "true"
    );
});

test("Future accordion does not close on outside click", () => {
    /*
     * What and why this test checks:
     * This ensures Future now matches Past behavior by only changing state via explicit header toggle.
     *
     * Passing scenario:
     * After opening Future, a mousedown on document.body keeps the panel open and rows visible.
     *
     * Failing scenario:
     * If outside clicks collapse it, Future still behaves unlike Past.
     */
    const view = renderFutureAccordion([buildTask("a", "Future A", toLocalIso(2026, 5, 3, 9, 0))]);

    fireEvent.click(view.getByRole("button", { name: "Future" }));
    assert.ok(view.getByText("Future A"));

    fireEvent.mouseDown(document.body);

    assert.ok(view.getByText("Future A"));
    assert.equal(
        view.getByRole("button", { name: "Future" }).getAttribute("aria-expanded"),
        "true"
    );
});

test("Future accordion restores open state from sessionStorage", () => {
    /*
     * What and why this test checks:
     * This validates Past-style session persistence so a user-expanded Future section remains open on refresh in the same tab.
     *
     * Passing scenario:
     * When sessionStorage contains the Future open key, the accordion renders expanded with its row visible.
     *
     * Failing scenario:
     * If saved session state is ignored, Future will always reset and not match Past behavior.
     */
    window.sessionStorage.setItem("dashboard.future.open", "1");

    const view = renderFutureAccordion([buildTask("a", "Future A", toLocalIso(2026, 5, 3, 9, 0))]);

    assert.ok(view.getByText("Future A"));
    assert.equal(
        view.getByRole("button", { name: "Future" }).getAttribute("aria-expanded"),
        "true"
    );
});

test("Future accordion is hidden when there are no future tasks", () => {
    /*
     * What and why this test checks:
     * This confirms we keep the dashboard concise by not rendering an empty Future section.
     *
     * Passing scenario:
     * With an empty list, no Future header/accordion is rendered.
     *
     * Failing scenario:
     * If an empty accordion still renders, the UI shows unnecessary structure and noise.
     */
    const view = renderFutureAccordion([]);

    assert.equal(view.queryByRole("button", { name: "Future" }), null);
    assert.equal(view.queryByTestId("future-accordion"), null);
});
