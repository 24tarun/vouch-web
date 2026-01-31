import { setup, assign } from "xstate";

// Task status types matching the PRD
export type TaskStatus =
    | "CREATED"
    | "ACTIVE"
    | "POSTPONED"
    | "MARKED_COMPLETED"
    | "AWAITING_VOUCHER"
    | "COMPLETED"
    | "FAILED"
    | "RECTIFIED"
    | "DELETED"
    | "SETTLED";

// Events that can trigger state transitions
export type TaskEvent =
    | { type: "ACTIVATE" }
    | { type: "POSTPONE"; newDeadline: Date }
    | { type: "MARK_COMPLETE" }
    | { type: "DEADLINE_PASSED" }
    | { type: "VOUCHER_ACCEPT" }
    | { type: "VOUCHER_DENY" }
    | { type: "TIMEOUT_24H" }
    | { type: "RECTIFY" }
    | { type: "MONTH_CLOSE" }
    | { type: "FORCE_MAJEURE" }
    | { type: "VOUCHER_DELETE" };

// Context for the task machine
export interface TaskContext {
    taskId: string;
    userId: string;
    voucherId: string;
    title: string;
    description?: string;
    failureCostCents: number;
    deadline: Date;
    postponedAt?: Date;
    markedCompletedAt?: Date;
    voucherResponseDeadline?: Date;
    createdAt: Date;
    updatedAt: Date;
}

// The task state machine
export const taskMachine = setup({
    types: {
        context: {} as TaskContext,
        events: {} as TaskEvent,
    },
    actions: {
        setPostponedAt: assign({
            postponedAt: () => new Date(),
            updatedAt: () => new Date(),
        }),
        setDeadline: assign({
            deadline: (_, params: { newDeadline: Date }) => params.newDeadline,
            updatedAt: () => new Date(),
        }),
        setMarkedCompletedAt: assign({
            markedCompletedAt: () => new Date(),
            updatedAt: () => new Date(),
        }),
        setVoucherResponseDeadline: assign({
            voucherResponseDeadline: () => {
                const deadline = new Date();
                deadline.setHours(deadline.getHours() + 24);
                return deadline;
            },
            updatedAt: () => new Date(),
        }),
        updateTimestamp: assign({
            updatedAt: () => new Date(),
        }),
    },
    guards: {
        canPostpone: ({ context }) => {
            // Can only postpone once (if postponedAt is not set)
            return context.postponedAt === undefined;
        },
        canPostponeBeforeDeadline: ({ context }) => {
            return context.postponedAt === undefined && new Date() < context.deadline;
        },
        isBeforeDeadline: ({ context }) => {
            return new Date() < context.deadline;
        },
    },
}).createMachine({
    id: "task",
    initial: "CREATED",
    context: {} as TaskContext,
    states: {
        CREATED: {
            on: {
                ACTIVATE: {
                    target: "ACTIVE",
                    actions: ["updateTimestamp"],
                },
                VOUCHER_DELETE: {
                    target: "DELETED",
                    actions: ["updateTimestamp"],
                },
            },
        },
        ACTIVE: {
            on: {
                POSTPONE: {
                    target: "POSTPONED",
                    guard: "canPostponeBeforeDeadline",
                    actions: [
                        "setPostponedAt",
                        {
                            type: "setDeadline",
                            params: ({ event }) => ({ newDeadline: event.newDeadline }),
                        },
                    ],
                },
                MARK_COMPLETE: {
                    target: "MARKED_COMPLETED",
                    guard: "isBeforeDeadline",
                    actions: ["setMarkedCompletedAt"],
                },
                DEADLINE_PASSED: {
                    target: "AWAITING_VOUCHER",
                    actions: ["setVoucherResponseDeadline"],
                },
                FORCE_MAJEURE: {
                    target: "SETTLED",
                    actions: ["updateTimestamp"],
                },
                VOUCHER_DELETE: {
                    target: "DELETED",
                    actions: ["updateTimestamp"],
                },
            },
        },
        POSTPONED: {
            on: {
                MARK_COMPLETE: {
                    target: "MARKED_COMPLETED",
                    guard: "isBeforeDeadline",
                    actions: ["setMarkedCompletedAt"],
                },
                DEADLINE_PASSED: {
                    target: "AWAITING_VOUCHER",
                    actions: ["setVoucherResponseDeadline"],
                },
                FORCE_MAJEURE: {
                    target: "SETTLED",
                    actions: ["updateTimestamp"],
                },
                VOUCHER_DELETE: {
                    target: "DELETED",
                    actions: ["updateTimestamp"],
                },
            },
        },
        MARKED_COMPLETED: {
            always: {
                target: "AWAITING_VOUCHER",
                actions: ["setVoucherResponseDeadline"],
            },
        },
        AWAITING_VOUCHER: {
            on: {
                VOUCHER_ACCEPT: {
                    target: "COMPLETED",
                    actions: ["updateTimestamp"],
                },
                VOUCHER_DENY: {
                    target: "FAILED",
                    actions: ["updateTimestamp"],
                },
                TIMEOUT_24H: {
                    target: "FAILED",
                    actions: ["updateTimestamp"],
                },
                VOUCHER_DELETE: {
                    target: "DELETED",
                    actions: ["updateTimestamp"],
                },
            },
        },
        COMPLETED: {
            on: {
                MONTH_CLOSE: {
                    target: "SETTLED",
                    actions: ["updateTimestamp"],
                },
            },
        },
        FAILED: {
            on: {
                RECTIFY: {
                    target: "RECTIFIED",
                    actions: ["updateTimestamp"],
                },
                MONTH_CLOSE: {
                    target: "SETTLED",
                    actions: ["updateTimestamp"],
                },
            },
        },
        RECTIFIED: {
            on: {
                MONTH_CLOSE: {
                    target: "SETTLED",
                    actions: ["updateTimestamp"],
                },
            },
        },
        SETTLED: {
            type: "final",
        },
        DELETED: {
            type: "final",
        },
    },
});

// Helper function to get valid transitions from a state
export function getValidTransitions(status: TaskStatus): TaskEvent["type"][] {
    const transitions: Record<TaskStatus, TaskEvent["type"][]> = {
        CREATED: ["ACTIVATE", "VOUCHER_DELETE"],
        ACTIVE: ["POSTPONE", "MARK_COMPLETE", "DEADLINE_PASSED", "FORCE_MAJEURE", "VOUCHER_DELETE"],
        POSTPONED: ["MARK_COMPLETE", "DEADLINE_PASSED", "FORCE_MAJEURE", "VOUCHER_DELETE"],
        MARKED_COMPLETED: [], // Auto-transitions to AWAITING_VOUCHER
        AWAITING_VOUCHER: ["VOUCHER_ACCEPT", "VOUCHER_DENY", "TIMEOUT_24H", "VOUCHER_DELETE"],
        COMPLETED: ["MONTH_CLOSE"],
        FAILED: ["RECTIFY", "MONTH_CLOSE"],
        RECTIFIED: ["MONTH_CLOSE"],
        DELETED: [],
        SETTLED: [],
    };
    return transitions[status];
}

// Helper to check if a transition is valid
export function canTransition(
    currentStatus: TaskStatus,
    event: TaskEvent["type"]
): boolean {
    return getValidTransitions(currentStatus).includes(event);
}
