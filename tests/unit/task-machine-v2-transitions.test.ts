import test from "node:test";
import assert from "node:assert/strict";
import { createActor } from "xstate";
import * as taskMachineModule from "../../src/lib/xstate/task-machine.ts";

const { canTransition, getValidTransitions, taskMachine } = taskMachineModule;

function buildMachineContext() {
    const now = new Date("2026-03-24T10:00:00.000Z");
    return {
        taskId: "task-1",
        userId: "user-1",
        voucherId: "voucher-1",
        title: "task title",
        failureCostCents: 100,
        deadline: new Date("2026-03-25T10:00:00.000Z"),
        createdAt: now,
        updatedAt: now,
    };
}

test("AWAITING_USER appeal transitions back to AWAITING_AI", () => {
    /*
     * What and why this test checks:
     * This verifies the appeal loop explicitly returns the task to AI review.
     *
     * Passing scenario:
     * Starting in AWAITING_USER and sending APPEAL moves the actor snapshot to AWAITING_AI.
     *
     * Failing scenario:
     * If APPEAL no longer reaches AWAITING_AI, users lose the defined appeal path.
     */
    const actor = createActor(taskMachine as any, {
        snapshot: (taskMachine as any).resolveState({
            value: "AWAITING_USER",
            context: buildMachineContext(),
        }),
    });
    actor.start();
    actor.send({ type: "APPEAL" } as any);

    assert.equal(actor.getSnapshot().value, "AWAITING_AI");
});

test("AI deny path lands in AWAITING_USER after transitional AI_DENIED", () => {
    /*
     * What and why this test checks:
     * This confirms AI_DENIED remains transitional and automatically lands in AWAITING_USER.
     *
     * Passing scenario:
     * Starting in AWAITING_AI and sending AI_DENY results in final snapshot AWAITING_USER.
     *
     * Failing scenario:
     * If the machine stays in AI_DENIED, users cannot take appeal/escalate actions.
     */
    const actor = createActor(taskMachine as any, {
        snapshot: (taskMachine as any).resolveState({
            value: "AWAITING_AI",
            context: buildMachineContext(),
        }),
    });
    actor.start();
    actor.send({ type: "AI_DENY" } as any);

    assert.equal(actor.getSnapshot().value, "AWAITING_USER");
});

test("AWAITING_AI transition list excludes AI timeout path", () => {
    /*
     * What and why this test checks:
     * This locks the timeout-removal contract so AI review has only approve/deny outcomes.
     *
     * Passing scenario:
     * Valid transitions are exactly AI_APPROVE and AI_DENY, and no TIMEOUT_AI entry exists.
     *
     * Failing scenario:
     * If timeout is reintroduced, AWAITING_USER could be reached without an AI denial event.
     */
    const transitions = getValidTransitions("AWAITING_AI");

    assert.deepEqual(transitions, ["AI_APPROVE", "AI_DENY"]);
    assert.equal((transitions as string[]).includes("TIMEOUT_AI"), false);
});

test("MARKED_COMPLETE keeps explicit voucher/ai decision transitions", () => {
    /*
     * What and why this test checks:
     * This verifies persisted MARKED_COMPLETE can still flow through voucher or AI decision outcomes.
     *
     * Passing scenario:
     * MARKED_COMPLETE allows voucher accept/deny, voucher timeout, and AI approve/deny events.
     *
     * Failing scenario:
     * If these events are removed, MARKED_COMPLETE becomes a dead-end and completion flow breaks.
     */
    const transitions = getValidTransitions("MARKED_COMPLETE").slice().sort();

    assert.deepEqual(transitions, [
        "AI_APPROVE",
        "AI_DENY",
        "TIMEOUT_VOUCHER",
        "VOUCHER_ACCEPT",
        "VOUCHER_DENY",
    ]);
    assert.equal(canTransition("MARKED_COMPLETE", "AI_APPROVE"), true);
    assert.equal(canTransition("AWAITING_AI", "TIMEOUT_VOUCHER"), false);
});
