import type { TaskStatus } from "@/lib/xstate/task-machine";

type PendingActions = ReadonlySet<string> | readonly string[];

function hasPendingAction(pendingActions: PendingActions, action: string): boolean {
    if (pendingActions instanceof Set) {
        return pendingActions.has(action);
    }

    return (pendingActions as readonly string[]).includes(action);
}

export interface TaskDetailButtonVisibilityInput {
    status: TaskStatus;
    pendingActions: PendingActions;
    isOwner: boolean;
    isActiveParentTask: boolean;
    isOverdue: boolean;
    isPastDeadline: boolean;
    isBeforeStart: boolean;
    incompleteSubtasksCount: number;
    hasIncompletePomoRequirement: boolean;
    hasRunningPomoForTask: boolean;
    hasPostponedAt: boolean;
    hasRecurrenceRule: boolean;
    isRepetitionStopped: boolean;
    canUseOverride: boolean;
    canTempDelete: boolean;
    canSurrender: boolean;
    canResubmit: boolean;
    escalationPending: boolean;
}

export function getTaskDetailButtonVisibility(input: TaskDetailButtonVisibilityInput) {
    const {
        status,
        pendingActions,
        isOwner,
        isActiveParentTask,
        isOverdue,
        isPastDeadline,
        isBeforeStart,
        incompleteSubtasksCount,
        hasIncompletePomoRequirement,
        hasRunningPomoForTask,
        hasPostponedAt,
        hasRecurrenceRule,
        isRepetitionStopped,
        canUseOverride,
        canTempDelete,
        canSurrender,
        canResubmit,
        escalationPending,
    } = input;

    return {
        awaiting: {
            addProof:
                isOwner &&
                !isPastDeadline &&
                !hasPendingAction(pendingActions, "awaitingProofUpload"),
            undoComplete:
                isOwner &&
                !hasPendingAction(pendingActions, "undoComplete") &&
                !isPastDeadline,
        },
        awaitingUser: {
            resubmitProof:
                isOwner &&
                canResubmit &&
                !hasPendingAction(pendingActions, "awaitingProofUpload"),
            escalateToFriend:
                isOwner &&
                !escalationPending,
            escalationChoice:
                isOwner &&
                !escalationPending,
        },
        proof: {
            removeStored:
                isOwner &&
                !isPastDeadline &&
                !hasPendingAction(pendingActions, "removeStoredProof"),
        },
        actions: {
            pomo:
                isOwner &&
                isActiveParentTask,
            attachProof:
                isOwner &&
                !hasPendingAction(pendingActions, "markComplete"),
            markComplete:
                isOwner &&
                isActiveParentTask &&
                !isOverdue &&
                !isBeforeStart &&
                incompleteSubtasksCount === 0 &&
                !hasIncompletePomoRequirement &&
                !hasRunningPomoForTask &&
                !hasPendingAction(pendingActions, "markComplete"),
            postpone:
                isOwner &&
                status === "ACTIVE" &&
                !hasPostponedAt &&
                !isOverdue &&
                !hasPendingAction(pendingActions, "postpone"),
            pauseRepetition:
                isOwner &&
                hasRecurrenceRule &&
                !isRepetitionStopped,
            cancelRepetition:
                isOwner &&
                hasRecurrenceRule &&
                !isRepetitionStopped,
            override:
                canUseOverride &&
                !hasPendingAction(pendingActions, "override"),
            tempDelete:
                isOwner &&
                canTempDelete &&
                !hasPendingAction(pendingActions, "tempDelete"),
            surrender:
                isOwner &&
                canSurrender &&
                !hasPendingAction(pendingActions, "surrender"),
            subtasksToggle: isOwner,
            remindersToggle: isOwner,
        },
    };
}

export interface TaskDetailSubtaskButtonVisibilityInput {
    canManageActionChildren: boolean;
    isPending: boolean;
    isAddingSubtask: boolean;
}

export function getTaskDetailSubtaskButtonVisibility(input: TaskDetailSubtaskButtonVisibilityInput) {
    const {
        canManageActionChildren,
        isPending,
        isAddingSubtask,
    } = input;

    return {
        add:
            canManageActionChildren &&
            !isAddingSubtask,
        toggle:
            canManageActionChildren &&
            !isPending,
        rename:
            canManageActionChildren &&
            !isPending,
        delete:
            canManageActionChildren &&
            !isPending,
    };
}

export interface TaskDetailReminderButtonVisibilityInput {
    canManageActionChildren: boolean;
    isSavePending: boolean;
    hasDraftValue: boolean;
    isPastReminder: boolean;
}

export function getTaskDetailReminderButtonVisibility(input: TaskDetailReminderButtonVisibilityInput) {
    const {
        canManageActionChildren,
        isSavePending,
        hasDraftValue,
        isPastReminder,
    } = input;

    return {
        add:
            canManageActionChildren &&
            !isSavePending &&
            hasDraftValue,
        remove:
            canManageActionChildren &&
            !isSavePending &&
            !isPastReminder,
    };
}
