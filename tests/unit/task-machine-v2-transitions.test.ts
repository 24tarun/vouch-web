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
    const transitions = getValidTransitions("AWAITING_AI");

    assert.deepEqual(transitions, ["AI_APPROVE", "AI_DENY"]);
    assert.equal((transitions as string[]).includes("TIMEOUT_AI"), false);
});

test("MARKED_COMPLETE keeps explicit voucher/ai decision transitions", () => {
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
