import { setup, assign } from "xstate";

// Task status types — V2 lifecycle
export type TaskStatus =
    | "ACTIVE"
    | "POSTPONED"
    | "MARKED_COMPLETE"
    | "AWAITING_VOUCHER"
    | "AWAITING_ORCA"
    | "ORCA_DENIED"
    | "AWAITING_USER"
    | "ESCALATED"
    | "ACCEPTED"
    | "AUTO_ACCEPTED"
    | "ORCA_ACCEPTED"
    | "DENIED"
    | "MISSED"
    | "RECTIFIED"
    | "DELETED"
    | "SETTLED";

// Events that can trigger state transitions
export type TaskEvent =
    { type: "POSTPONE"; newDeadline: Date }
    | { type: "MARK_COMPLETE" }
    | { type: "DEADLINE_PASSED" }
    | { type: "VOUCHER_ACCEPT" }
    | { type: "VOUCHER_DENY" }
    | { type: "ORCA_APPROVE" }
    | { type: "ORCA_DENY" }
    | { type: "APPEAL" }
    | { type: "ACCEPT_DENIAL" }
    | { type: "ESCALATE" }
    | { type: "TIMEOUT_VOUCHER" }
    | { type: "RECTIFY" }
    | { type: "MONTH_CLOSE" }
    | { type: "FORCE_MAJEURE" };

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
                deadline.setDate(deadline.getDate() + 2);
                deadline.setHours(23, 59, 59, 999);
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
    initial: "ACTIVE",
    context: {} as TaskContext,
    states: {
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
                    target: "MARKED_COMPLETE",
                    guard: "isBeforeDeadline",
                    actions: ["setMarkedCompletedAt"],
                },
                DEADLINE_PASSED: {
                    target: "MISSED",
                    actions: ["updateTimestamp"],
                },
                FORCE_MAJEURE: {
                    target: "SETTLED",
                    actions: ["updateTimestamp"],
                },
            },
        },
        POSTPONED: {
            on: {
                MARK_COMPLETE: {
                    target: "MARKED_COMPLETE",
                    guard: "isBeforeDeadline",
                    actions: ["setMarkedCompletedAt"],
                },
                DEADLINE_PASSED: {
                    target: "MISSED",
                    actions: ["updateTimestamp"],
                },
                FORCE_MAJEURE: {
                    target: "SETTLED",
                    actions: ["updateTimestamp"],
                },
            },
        },
        MARKED_COMPLETE: {
            on: {
                VOUCHER_ACCEPT: {
                    target: "ACCEPTED",
                    actions: ["updateTimestamp"],
                },
                VOUCHER_DENY: {
                    target: "DENIED",
                    actions: ["updateTimestamp"],
                },
                TIMEOUT_VOUCHER: {
                    target: "AUTO_ACCEPTED",
                    actions: ["updateTimestamp"],
                },
                ORCA_APPROVE: {
                    target: "ORCA_ACCEPTED",
                    actions: ["updateTimestamp"],
                },
                ORCA_DENY: {
                    target: "ORCA_DENIED",
                    actions: ["updateTimestamp"],
                },
            },
        },
        AWAITING_VOUCHER: {
            on: {
                VOUCHER_ACCEPT: {
                    target: "ACCEPTED",
                    actions: ["updateTimestamp"],
                },
                VOUCHER_DENY: {
                    target: "DENIED",
                    actions: ["updateTimestamp"],
                },
                TIMEOUT_VOUCHER: {
                    target: "AUTO_ACCEPTED",
                    actions: ["updateTimestamp"],
                },
            },
        },
        AWAITING_ORCA: {
            on: {
                ORCA_APPROVE: {
                    target: "ORCA_ACCEPTED",
                    actions: ["updateTimestamp"],
                },
                ORCA_DENY: {
                    target: "ORCA_DENIED",
                    actions: ["updateTimestamp"],
                },
            },
        },
        ORCA_DENIED: {
            // Auto-transitions to AWAITING_USER (transitional, logged)
            always: {
                target: "AWAITING_USER",
            },
        },
        AWAITING_USER: {
            on: {
                APPEAL: {
                    // Resubmit to Orca (if denial count < 3)
                    target: "AWAITING_ORCA",
                    actions: ["updateTimestamp"],
                },
                ESCALATE: {
                    target: "ESCALATED",
                    actions: ["updateTimestamp"],
                },
                ACCEPT_DENIAL: {
                    target: "DENIED",
                    actions: ["updateTimestamp"],
                },
            },
        },
        ESCALATED: {
            // Auto-transitions to AWAITING_VOUCHER (transitional, logged)
            always: {
                target: "AWAITING_VOUCHER",
                actions: ["setVoucherResponseDeadline"],
            },
        },
        ACCEPTED: {
            on: {
                MONTH_CLOSE: {
                    target: "SETTLED",
                    actions: ["updateTimestamp"],
                },
            },
        },
        AUTO_ACCEPTED: {
            on: {
                MONTH_CLOSE: {
                    target: "SETTLED",
                    actions: ["updateTimestamp"],
                },
            },
        },
        ORCA_ACCEPTED: {
            on: {
                MONTH_CLOSE: {
                    target: "SETTLED",
                    actions: ["updateTimestamp"],
                },
            },
        },
        DENIED: {
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
        MISSED: {
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
        ACTIVE: ["POSTPONE", "MARK_COMPLETE", "DEADLINE_PASSED", "FORCE_MAJEURE"],
        POSTPONED: ["MARK_COMPLETE", "DEADLINE_PASSED", "FORCE_MAJEURE"],
        MARKED_COMPLETE: ["VOUCHER_ACCEPT", "VOUCHER_DENY", "TIMEOUT_VOUCHER", "ORCA_APPROVE", "ORCA_DENY"],
        AWAITING_VOUCHER: ["VOUCHER_ACCEPT", "VOUCHER_DENY", "TIMEOUT_VOUCHER"],
        AWAITING_ORCA: ["ORCA_APPROVE", "ORCA_DENY"],
        ORCA_DENIED: [], // Auto-transitions to AWAITING_USER
        AWAITING_USER: ["APPEAL", "ESCALATE", "ACCEPT_DENIAL"],
        ESCALATED: [], // Auto-transitions to AWAITING_VOUCHER
        ACCEPTED: ["MONTH_CLOSE"],
        AUTO_ACCEPTED: ["MONTH_CLOSE"],
        ORCA_ACCEPTED: ["MONTH_CLOSE"],
        DENIED: ["RECTIFY", "MONTH_CLOSE"],
        MISSED: ["RECTIFY", "MONTH_CLOSE"],
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

// Success statuses (task completed one way or another)
export const SUCCESS_STATUSES: TaskStatus[] = ["ACCEPTED", "AUTO_ACCEPTED", "ORCA_ACCEPTED"];

// Failure statuses (task not completed)
export const FAILURE_STATUSES: TaskStatus[] = ["DENIED", "MISSED"];

// Active (pre-completion) statuses
export const ACTIVE_STATUSES: TaskStatus[] = ["ACTIVE", "POSTPONED"];

// Terminal statuses
export const TERMINAL_STATUSES: TaskStatus[] = [
    ...SUCCESS_STATUSES,
    ...FAILURE_STATUSES,
    "RECTIFIED",
    "SETTLED",
    "DELETED",
];
