import test from "node:test";
import assert from "node:assert/strict";
import { TextDecoder, TextEncoder } from "node:util";
import { JSDOM } from "jsdom";
import React from "react";
import { cleanup, render } from "@testing-library/react";
import {
    CompactHistoryItem,
    CompactPendingItem,
    applyProofRequestSuccessToPendingTasks,
    getVoucherActionablePendingTasks,
    getVoucherActiveTasks,
} from "../../src/app/(app)/voucher/voucher-dashboard-client";
import type { Profile, VoucherPendingTask } from "../../src/lib/types";

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

function buildPendingTask(overrides: Partial<VoucherPendingTask> = {}): VoucherPendingTask {
    return {
        id: "task-1",
        user_id: "owner-1",
        voucher_id: "voucher-1",
        title: "Task title",
        description: null,
        failure_cost_cents: 100,
        required_pomo_minutes: null,
        deadline: "2026-03-13T18:00:00.000Z",
        status: "AWAITING_VOUCHER",
        postponed_at: null,
        marked_completed_at: "2026-03-13T12:00:00.000Z",
        voucher_response_deadline: "2026-03-15T23:59:59.999Z",
        recurrence_rule_id: null,
        google_sync_for_task: false,
        created_at: "2026-03-13T10:00:00.000Z",
        updated_at: "2026-03-13T12:00:00.000Z",
        pending_display_type: "AWAITING_VOUCHER",
        pending_deadline_at: "2026-03-15T23:59:59.999Z",
        pending_actionable: true,
        proof_request_count: 0,
        ...overrides,
    };
}

function buildProfile(overrides: Partial<Profile> = {}): Profile {
    return {
        id: "owner-1",
        email: "owner@example.com",
        username: "owner",
        currency: "EUR",
        default_pomo_duration_minutes: 25,
        default_event_duration_minutes: 60,
        default_task_deadline_time: "23:00",
        default_failure_cost_cents: 100,
        default_voucher_id: null,
        default_requires_proof_for_all_tasks: false,
        auto_submit_after_proof_upload: true,
        strict_pomo_enabled: false,
        deadline_one_hour_warning_enabled: true,
        deadline_final_warning_enabled: true,
        deadline_due_warning_enabled: true,
        voucher_can_view_active_tasks: true,
        always_show_active_tasks: false,
        show_past_tasks: true,
        charity_enabled: false,
        selected_charity_id: null,
        timezone: "UTC",
        timezone_user_set: false,
        hide_tips: false,
        created_at: "2026-03-13T10:00:00.000Z",
        ...overrides,
    };
}

test("voucher pending row shows ?N badge only when proof request is open with count > 0", () => {
    const openProofTask = buildPendingTask({
        id: "task-open",
        proof_request_open: true,
        proof_request_count: 4,
    });
    const closedProofTask = buildPendingTask({
        id: "task-closed",
        proof_request_open: false,
        proof_request_count: 4,
    });

    const openView = render(
        <CompactPendingItem
            task={openProofTask}
            onAccept={() => { }}
            onDeny={() => { }}
            onRequestProof={() => { }}
            isLoading={false}
        />
    );

    assert.ok(openView.getByText("?4"));

    openView.unmount();
    const closedView = render(
        <CompactPendingItem
            task={closedProofTask}
            onAccept={() => { }}
            onDeny={() => { }}
            onRequestProof={() => { }}
            isLoading={false}
        />
    );

    assert.equal(closedView.queryByText("?4"), null);
});

test("proof-request success patch opens request state and increments per-task counter immediately", () => {
    const before = [
        buildPendingTask({
            id: "task-1",
            proof_request_open: false,
            proof_request_count: 1,
            proof_requested_at: null,
        }),
        buildPendingTask({
            id: "task-2",
            proof_request_open: false,
            proof_request_count: 0,
            proof_requested_at: null,
        }),
    ];
    const nowIso = "2026-03-13T12:30:00.000Z";

    const after = applyProofRequestSuccessToPendingTasks(before, "task-1", nowIso);

    assert.equal(after[0]?.proof_request_open, true);
    assert.equal(after[0]?.proof_requested_at, nowIso);
    assert.equal(after[0]?.proof_request_count, 2);
    assert.equal(after[1]?.proof_request_count, 0);
    assert.equal(after[1]?.proof_request_open, false);
});

test("friends page buckets active voucher tasks away from actionable pending requests", () => {
    const activeTask = buildPendingTask({
        id: "active-task",
        status: "ACTIVE",
        marked_completed_at: null,
        voucher_response_deadline: null,
        pending_display_type: "ACTIVE",
        pending_deadline_at: "2026-03-13T18:00:00.000Z",
        pending_actionable: false,
    });
    const awaitingTask = buildPendingTask({
        id: "awaiting-task",
        status: "AWAITING_VOUCHER",
        pending_display_type: "AWAITING_VOUCHER",
        pending_actionable: true,
    });

    const activeTasks = getVoucherActiveTasks([activeTask, awaitingTask]);
    const actionablePendingTasks = getVoucherActionablePendingTasks([activeTask, awaitingTask]);

    assert.deepEqual(activeTasks.map((task) => task.id), ["active-task"]);
    assert.deepEqual(actionablePendingTasks.map((task) => task.id), ["awaiting-task"]);
});

test("active voucher row reuses pending row layout without review action buttons", () => {
    const deadlineIso = "2026-03-13T18:00:00.000Z";
    const expectedDeadlineLabel = new Date(deadlineIso).toLocaleString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
    const activeTask = buildPendingTask({
        id: "active-task",
        title: "Testing active row",
        status: "ACTIVE",
        deadline: deadlineIso,
        marked_completed_at: null,
        voucher_response_deadline: null,
        pending_display_type: "ACTIVE",
        pending_deadline_at: deadlineIso,
        pending_actionable: false,
    });

    const view = render(
        <CompactPendingItem
            task={activeTask}
            onAccept={() => { }}
            onDeny={() => { }}
            onRequestProof={() => { }}
            isLoading={false}
        />
    );

    assert.ok(view.getByText("Testing active row"));
    assert.ok(view.getByText("ACTIVE"));
    assert.ok(view.getByText(expectedDeadlineLabel));
    assert.equal(view.queryByLabelText("Accept task Testing active row"), null);
    assert.equal(view.queryByLabelText("Deny task Testing active row"), null);
    assert.equal(view.queryByLabelText("Request proof for task Testing active row"), null);
});

test("vouched history row keeps title separate and renders status/date as pills", () => {
    const updatedAtIso = "2026-06-11T12:00:00.000Z";
    const expectedDateLabel = new Date(updatedAtIso).toLocaleDateString();
    const historyTask: VoucherPendingTask = {
        ...buildPendingTask({
            id: "history-task",
            title: "Finished task",
            status: "ACCEPTED",
            updated_at: updatedAtIso,
        }),
        user: buildProfile({ username: "madhu" }),
    };

    const view = render(
        <CompactHistoryItem
            task={historyTask}
            onRectify={() => { }}
            isLoading={false}
        />
    );

    const titleElement = view.getByText("Finished task");
    const metaRow = titleElement.nextElementSibling;
    const statusBadge = view.getByText("ACCEPTED").closest("[data-slot='badge']");
    const dateBadge = view.getByText(expectedDateLabel).closest("[data-slot='badge']");

    assert.equal(titleElement.textContent, "Finished task");
    assert.ok(metaRow?.textContent?.includes("madhu"));
    assert.equal(statusBadge?.parentElement, metaRow);
    assert.equal(dateBadge?.parentElement, metaRow);
});
