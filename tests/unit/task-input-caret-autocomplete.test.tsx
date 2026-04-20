import test from "node:test";
import assert from "node:assert/strict";
import { TextDecoder, TextEncoder } from "node:util";
import { JSDOM } from "jsdom";
import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { TaskInput } from "../../src/components/TaskInput";
import type { Profile } from "../../src/lib/types";

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

const htmlElementPrototype = globalAny.HTMLElement.prototype as {
    attachEvent?: (...args: unknown[]) => void;
    detachEvent?: (...args: unknown[]) => void;
};
if (!htmlElementPrototype.attachEvent) {
    htmlElementPrototype.attachEvent = () => { };
}
if (!htmlElementPrototype.detachEvent) {
    htmlElementPrototype.detachEvent = () => { };
}

test.afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
});

function setTitleInputValueAndCaret(input: HTMLInputElement, value: string): void {
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value } });
    input.setSelectionRange(value.length, value.length);
    fireEvent.select(input);
}

function buildProfile(id: string, username: string, email: string): Profile {
    return {
        id,
        username,
        email,
        currency: "EUR",
        default_pomo_duration_minutes: 25,
        default_event_duration_minutes: 60,
        default_failure_cost_cents: 100,
        default_voucher_id: null,
        strict_pomo_enabled: false,
        deadline_one_hour_warning_enabled: true,
        deadline_final_warning_enabled: true,
        voucher_can_view_active_tasks: true,
        charity_enabled: false,
        selected_charity_id: null,
        timezone: "UTC",
        timezone_user_set: false,
        hide_tips: false,
        created_at: "2026-01-01T00:00:00.000Z",
    };
}

test("typing partial keyword keeps caret at native input end while ghost suffix appears", async () => {
    const selfId = "self-1";
    const friends = [buildProfile("friend-1", "madhu", "madhu@example.com")];

    const view = render(
        <TaskInput
            friends={friends}
            defaultFailureCostEuros="1.00"
            defaultCurrency="EUR"
            defaultVoucherId={selfId}
            defaultEventDurationMinutes={60}
            selfUserId={selfId}
        />
    );

    const input = view.getByPlaceholderText("click the bulb button on the right") as HTMLInputElement;
    const typed = "check dustbin emptiness tmr";
    setTitleInputValueAndCaret(input, typed);
    await waitFor(() => {
        assert.equal(view.getByTestId("task-input-completion-suffix").textContent, "w");
    });

    /*
     * What and why this test checks:
     * This validates the primary caret bug regression path: keyword-driven ghost completion should not move the real input caret.
     * We intentionally type a partial `tmr` token that triggers `tmrw` suffix rendering.
     *
     * Passing scenario:
     * Native input value remains unchanged (`... tmr`), caret stays at value end, and the ghost suffix (`w`) renders separately.
     *
     * Failing scenario:
     * If caret drifts or the value mutates prematurely, typing appears offset and users lose deterministic cursor behavior.
     */
    await waitFor(() => {
        assert.equal(input.value, "check dustbin emptiness tmr");
        assert.equal(input.selectionStart, input.value.length);
    });
    assert.equal(view.getByTestId("task-input-completion-suffix").textContent, "w");
});

test("Tab accepts completion atomically and places caret at inserted token end", async () => {
    const selfId = "self-1";
    const friends = [buildProfile("friend-1", "madhu", "madhu@example.com")];

    const view = render(
        <TaskInput
            friends={friends}
            defaultFailureCostEuros="1.00"
            defaultCurrency="EUR"
            defaultVoucherId={selfId}
            defaultEventDurationMinutes={60}
            selfUserId={selfId}
        />
    );

    const input = view.getByPlaceholderText("click the bulb button on the right") as HTMLInputElement;
    const typed = "check dustbin emptiness tmr";
    setTitleInputValueAndCaret(input, typed);
    await waitFor(() => {
        assert.equal(view.getByTestId("task-input-completion-suffix").textContent, "w");
    });
    fireEvent.keyDown(input, { key: "Tab", code: "Tab" });

    /*
     * What and why this test checks:
     * This checks atomic completion application: Tab should replace only the active fragment and update selection in the same transaction.
     * It protects against stale selection writes that can leave the caret behind after autocomplete accept.
     *
     * Passing scenario:
     * Value becomes `... tmrw`, caret equals new value length, and suffix overlay disappears because completion is fully applied.
     *
     * Failing scenario:
     * If caret lands before the inserted token or suffix remains, users see duplicated/misaligned completion behavior.
     */
    await waitFor(() => {
        assert.equal(input.value, "check dustbin emptiness tmrw");
        assert.equal(input.selectionStart, input.value.length);
    });
    assert.equal(view.queryByTestId("task-input-completion-suffix"), null);
});

test("tapping ghost suffix accepts completion and places caret at inserted token end", async () => {
    const selfId = "self-1";
    const friends = [buildProfile("friend-1", "madhu", "madhu@example.com")];

    const view = render(
        <TaskInput
            friends={friends}
            defaultFailureCostEuros="1.00"
            defaultCurrency="EUR"
            defaultVoucherId={selfId}
            defaultEventDurationMinutes={60}
            selfUserId={selfId}
        />
    );

    const input = view.getByPlaceholderText("click the bulb button on the right") as HTMLInputElement;
    const typed = "check dustbin emptiness tmr";
    setTitleInputValueAndCaret(input, typed);
    const suffix = await waitFor(() => {
        const node = view.getByTestId("task-input-completion-suffix");
        assert.equal(node.textContent, "w");
        return node;
    });
    fireEvent.click(suffix);

    /*
     * What and why this test checks:
     * This validates the mobile tap path for inline autocomplete by tapping the rendered ghost suffix itself.
     * The interaction must mirror Tab acceptance so touch users get deterministic completion behavior without a hardware keyboard.
     *
     * Passing scenario:
     * Tapping the suffix applies `tmrw` atomically, places caret at the end, and removes the suffix overlay node.
     *
     * Failing scenario:
     * If tap does not apply completion (or leaves caret/suffix in stale state), mobile users lose parity with the desktop Tab flow.
     */
    await waitFor(() => {
        assert.equal(input.value, "check dustbin emptiness tmrw");
        assert.equal(input.selectionStart, input.value.length);
    });
    assert.equal(view.queryByTestId("task-input-completion-suffix"), null);
});

test("tapping completion fragment does not auto-accept completion", async () => {
    const selfId = "self-1";
    const friends = [buildProfile("friend-1", "madhu", "madhu@example.com")];

    const view = render(
        <TaskInput
            friends={friends}
            defaultFailureCostEuros="1.00"
            defaultCurrency="EUR"
            defaultVoucherId={selfId}
            defaultEventDurationMinutes={60}
            selfUserId={selfId}
        />
    );

    const input = view.getByPlaceholderText("click the bulb button on the right") as HTMLInputElement;
    const typed = "check dustbin emptiness tmr";
    setTitleInputValueAndCaret(input, typed);
    const fragmentNode = await waitFor(() => {
        const candidates = view.getAllByTestId("task-input-completion-fragment");
        const target = candidates.find((node) => node.textContent === "tmr");
        assert.ok(target);
        return target;
    });
    fireEvent.click(fragmentNode);

    /*
     * What and why this test checks:
     * This validates the anti-accidental-accept behavior for inline completion fragments.
     * Only the ghost suffix should commit autocomplete; tapping already-typed fragment text should preserve normal editing intent.
     *
     * Passing scenario:
     * Tapping the fragment keeps value/caret unchanged (`... tmr`) and leaves suffix visible for explicit acceptance.
     *
     * Failing scenario:
     * If fragment taps apply completion, users can trigger unwanted replacements while trying to position caret near highlighted text.
     */
    await waitFor(() => {
        assert.equal(input.value, "check dustbin emptiness tmr");
        assert.equal(input.selectionStart, input.value.length);
    });
    assert.equal(view.getByTestId("task-input-completion-suffix").textContent, "w");
});

test("weekday completion suffix is contiguous with typed fragment in overlay stream", async () => {
    const selfId = "self-1";
    const friends = [buildProfile("friend-1", "madhu", "madhu@example.com")];

    const view = render(
        <TaskInput
            friends={friends}
            defaultFailureCostEuros="1.00"
            defaultCurrency="EUR"
            defaultVoucherId={selfId}
            defaultEventDurationMinutes={60}
            selfUserId={selfId}
        />
    );

    const input = view.getByPlaceholderText("click the bulb button on the right") as HTMLInputElement;
    const typed = "groceries mond";
    setTitleInputValueAndCaret(input, typed);

    const suffix = await waitFor(() => {
        const node = view.getByTestId("task-input-completion-suffix");
        assert.equal(node.textContent, "ay");
        return node;
    });

    /*
     * What and why this test checks:
     * This verifies the overlay render stream keeps typed fragment and ghost suffix contiguous for weekday completion.
     * It prevents the visual split bug where `mond` and `ay` appear separated by an unintended extra space/gap.
     *
     * Passing scenario:
     * The overlay text stream reads exactly `groceries monday`, with no inserted whitespace between fragment and suffix.
     *
     * Failing scenario:
     * If text stream contains additional whitespace around suffix, users see a visible gap and misaligned inline completion.
     */
    assert.equal(suffix.parentElement?.textContent, "groceries monday");
});

test("Tab completion is ignored during composition and only applies after composition ends", async () => {
    const selfId = "self-1";
    const friends = [buildProfile("friend-1", "madhu", "madhu@example.com")];

    const view = render(
        <TaskInput
            friends={friends}
            defaultFailureCostEuros="1.00"
            defaultCurrency="EUR"
            defaultVoucherId={selfId}
            defaultEventDurationMinutes={60}
            selfUserId={selfId}
        />
    );

    const input = view.getByPlaceholderText("click the bulb button on the right") as HTMLInputElement;
    const typed = "check dustbin emptiness tmr";
    setTitleInputValueAndCaret(input, typed);

    await waitFor(() => {
        assert.equal(view.getByTestId("task-input-completion-suffix").textContent, "w");
    });

    fireEvent.keyDown(input, { key: "Tab", code: "Tab", isComposing: true });

    /*
     * What and why this test checks:
     * This validates the IME safety guard in the new keydown flow: completion shortcuts must not fire while composition is active.
     * The component intentionally blocks Enter/Tab actions during composition to avoid corrupting partially composed characters.
     *
     * Passing scenario:
     * During composition, Tab does not apply completion and the title remains `... tmr`. After composition ends, Tab applies `tmrw` normally.
     *
     * Failing scenario:
     * If completion applies during composition, IME users can lose in-progress text and experience broken caret/selection behavior.
     */
    await waitFor(() => {
        assert.equal(input.value, typed);
        assert.equal(view.getByTestId("task-input-completion-suffix").textContent, "w");
    });

    fireEvent.keyDown(input, { key: "Tab", code: "Tab", isComposing: false });

    await waitFor(() => {
        assert.equal(input.value, "check dustbin emptiness tmrw");
        assert.equal(input.selectionStart, input.value.length);
    });
});
