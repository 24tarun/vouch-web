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

test("AWAITING_USER appeal transitions back to AWAITING_ORCA", () => {
    /*
     * What and why this test checks:
     * This verifies the appeal loop explicitly returns the task to Orca review.
     *
     * Passing scenario:
     * Starting in AWAITING_USER and sending APPEAL moves the actor snapshot to AWAITING_ORCA.
     *
     * Failing scenario:
     * If APPEAL no longer reaches AWAITING_ORCA, users lose the defined appeal path.
     */
    const actor = createActor(taskMachine as any, {
        snapshot: (taskMachine as any).resolveState({
            value: "AWAITING_USER",
            context: buildMachineContext(),
        }),
    });
    actor.start();
    actor.send({ type: "APPEAL" } as any);

    assert.equal(actor.getSnapshot().value, "AWAITING_ORCA");
});

test("Orca deny path lands in AWAITING_USER after transitional ORCA_DENIED", () => {
    /*
     * What and why this test checks:
     * This confirms ORCA_DENIED remains transitional and automatically lands in AWAITING_USER.
     *
     * Passing scenario:
     * Starting in AWAITING_ORCA and sending ORCA_DENY results in final snapshot AWAITING_USER.
     *
     * Failing scenario:
     * If the machine stays in ORCA_DENIED, users cannot take appeal/escalate actions.
     */
    const actor = createActor(taskMachine as any, {
        snapshot: (taskMachine as any).resolveState({
            value: "AWAITING_ORCA",
            context: buildMachineContext(),
        }),
    });
    actor.start();
    actor.send({ type: "ORCA_DENY" } as any);

    assert.equal(actor.getSnapshot().value, "AWAITING_USER");
});

test("AWAITING_ORCA transition list excludes Orca timeout path", () => {
    /*
     * What and why this test checks:
     * This locks the timeout-removal contract so Orca review has only approve/deny outcomes.
     *
     * Passing scenario:
     * Valid transitions are exactly ORCA_APPROVE and ORCA_DENY, and no TIMEOUT_ORCA entry exists.
     *
     * Failing scenario:
     * If timeout is reintroduced, AWAITING_USER could be reached without an Orca denial event.
     */
    const transitions = getValidTransitions("AWAITING_ORCA");

    assert.deepEqual(transitions, ["ORCA_APPROVE", "ORCA_DENY"]);
    assert.equal((transitions as string[]).includes("TIMEOUT_ORCA"), false);
});

test("MARKED_COMPLETE keeps explicit voucher/orca decision transitions", () => {
    /*
     * What and why this test checks:
     * This verifies persisted MARKED_COMPLETE can still flow through voucher or Orca decision outcomes.
     *
     * Passing scenario:
     * MARKED_COMPLETE allows voucher accept/deny, voucher timeout, and Orca approve/deny events.
     *
     * Failing scenario:
     * If these events are removed, MARKED_COMPLETE becomes a dead-end and completion flow breaks.
     */
    const transitions = getValidTransitions("MARKED_COMPLETE").slice().sort();

    assert.deepEqual(transitions, [
        "ORCA_APPROVE",
        "ORCA_DENY",
        "TIMEOUT_VOUCHER",
        "VOUCHER_ACCEPT",
        "VOUCHER_DENY",
    ]);
    assert.equal(canTransition("MARKED_COMPLETE", "ORCA_APPROVE"), true);
    assert.equal(canTransition("AWAITING_ORCA", "TIMEOUT_VOUCHER"), false);
});
