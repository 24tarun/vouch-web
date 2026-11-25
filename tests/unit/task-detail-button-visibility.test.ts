import test from "node:test";
import assert from "node:assert/strict";
import {
    getTaskDetailButtonVisibility,
    getTaskDetailReminderButtonVisibility,
    getTaskDetailSubtaskButtonVisibility,
} from "../../src/lib/task-detail-button-visibility";

test("active owner sees only currently actionable top-level task detail buttons", () => {
    const visibility = getTaskDetailButtonVisibility({
        status: "ACTIVE",
        pendingActions: [],
        isOwner: true,
        isActiveParentTask: true,
        isOverdue: false,
        isPastDeadline: false,
        isBeforeStart: false,
        incompleteSubtasksCount: 0,
        hasIncompletePomoRequirement: false,
        hasRunningPomoForTask: false,
        hasPostponedAt: false,
        hasRecurrenceRule: true,
        isRepetitionStopped: false,
        canUseOverride: false,
        canTempDelete: true,
        canSurrender: false,
        canResubmit: false,
        escalationPending: false,
    });

    assert.deepEqual(visibility.actions, {
        pomo: true,
        attachProof: true,
        markComplete: true,
        postpone: true,
        pauseRepetition: true,
        cancelRepetition: true,
        override: false,
        tempDelete: true,
        surrender: false,
        subtasksToggle: true,
        remindersToggle: true,
    });
});

test("non-owner task detail view hides owner-only top-level buttons entirely", () => {
    const visibility = getTaskDetailButtonVisibility({
        status: "ACTIVE",
        pendingActions: [],
        isOwner: false,
        isActiveParentTask: true,
        isOverdue: false,
        isPastDeadline: false,
        isBeforeStart: false,
        incompleteSubtasksCount: 0,
        hasIncompletePomoRequirement: false,
        hasRunningPomoForTask: false,
        hasPostponedAt: false,
        hasRecurrenceRule: true,
        isRepetitionStopped: false,
        canUseOverride: false,
        canTempDelete: false,
        canSurrender: true,
        canResubmit: false,
        escalationPending: false,
    });

    assert.deepEqual(visibility.awaiting, {
        addProof: false,
        undoComplete: false,
    });
    assert.deepEqual(visibility.awaitingUser, {
        resubmitProof: false,
        escalateToFriend: false,
        escalationChoice: false,
    });
    assert.deepEqual(visibility.proof, {
        removeStored: false,
    });
    assert.deepEqual(visibility.actions, {
        pomo: false,
        attachProof: false,
        markComplete: false,
        postpone: false,
        pauseRepetition: false,
        cancelRepetition: false,
        override: false,
        tempDelete: false,
        surrender: false,
        subtasksToggle: false,
        remindersToggle: false,
    });
});

test("owner sees surrender in place of delete after the delete window expires", () => {
    const visibility = getTaskDetailButtonVisibility({
        status: "ACTIVE",
        pendingActions: [],
        isOwner: true,
        isActiveParentTask: true,
        isOverdue: false,
        isPastDeadline: false,
        isBeforeStart: false,
        incompleteSubtasksCount: 0,
        hasIncompletePomoRequirement: false,
        hasRunningPomoForTask: false,
        hasPostponedAt: false,
        hasRecurrenceRule: false,
        isRepetitionStopped: false,
        canUseOverride: false,
        canTempDelete: false,
        canSurrender: true,
        canResubmit: false,
        escalationPending: false,
    });

    assert.equal(visibility.actions.tempDelete, false);
    assert.equal(visibility.actions.surrender, true);
});

test("historical owners can pause or stop a surviving recurrence rule", () => {
    const visibility = getTaskDetailButtonVisibility({
        status: "ACCEPTED",
        pendingActions: [],
        isOwner: true,
        isActiveParentTask: false,
        isOverdue: false,
        isPastDeadline: false,
        isBeforeStart: false,
        incompleteSubtasksCount: 0,
        hasIncompletePomoRequirement: false,
        hasRunningPomoForTask: false,
        hasPostponedAt: false,
        hasRecurrenceRule: true,
        isRepetitionStopped: false,
        canUseOverride: false,
        canTempDelete: false,
        canSurrender: false,
        canResubmit: false,
        escalationPending: false,
    });

    assert.equal(visibility.actions.pauseRepetition, true);
    assert.equal(visibility.actions.cancelRepetition, true);
    assert.equal(visibility.actions.markComplete, false);
    assert.equal(visibility.actions.subtasksToggle, true);

    assert.deepEqual(getTaskDetailSubtaskButtonVisibility({
        canManageActionChildren: false,
        isPending: false,
        isAddingSubtask: false,
    }), {
        add: false,
        toggle: false,
        rename: false,
        delete: false,
    });
});

test("awaiting owner actions disappear when pending or when undo complete is blocked after deadline", () => {
    const visibility = getTaskDetailButtonVisibility({
        status: "AWAITING_VOUCHER",
        pendingActions: ["awaitingProofUpload", "undoComplete", "removeStoredProof"],
        isOwner: true,
        isActiveParentTask: false,
        isOverdue: true,
        isPastDeadline: true,
        isBeforeStart: false,
        incompleteSubtasksCount: 0,
        hasIncompletePomoRequirement: false,
        hasRunningPomoForTask: false,
        hasPostponedAt: false,
        hasRecurrenceRule: false,
        isRepetitionStopped: false,
        canUseOverride: false,
        canTempDelete: false,
        canSurrender: false,
        canResubmit: false,
        escalationPending: false,
    });

    assert.equal(visibility.awaiting.addProof, false);
    assert.equal(visibility.awaiting.undoComplete, false);
    assert.equal(visibility.proof.removeStored, false);
});

test("proof edits and undo remain visible before expiry and hide after expiry for every completed waiting state", () => {
    for (const status of ["AWAITING_VOUCHER", "AWAITING_AI", "MARKED_COMPLETE"] as const) {
        const shared = {
            status,
            pendingActions: [],
            isOwner: true,
            isActiveParentTask: false,
            isOverdue: false,
            isBeforeStart: false,
            incompleteSubtasksCount: 0,
            hasIncompletePomoRequirement: false,
            hasRunningPomoForTask: false,
            hasPostponedAt: false,
            hasRecurrenceRule: false,
            isRepetitionStopped: false,
            canUseOverride: false,
            canTempDelete: false,
            canSurrender: false,
            canResubmit: false,
            escalationPending: false,
        };

        const beforeExpiry = getTaskDetailButtonVisibility({ ...shared, isPastDeadline: false });
        assert.equal(beforeExpiry.awaiting.addProof, true);
        assert.equal(beforeExpiry.awaiting.undoComplete, true);
        assert.equal(beforeExpiry.proof.removeStored, true);

        const afterExpiry = getTaskDetailButtonVisibility({ ...shared, isPastDeadline: true });
        assert.equal(afterExpiry.awaiting.addProof, false);
        assert.equal(afterExpiry.awaiting.undoComplete, false);
        assert.equal(afterExpiry.proof.removeStored, false);
    }
});

test("nested subtask and reminder controls render only when their actions are available", () => {
    const lockedSubtaskVisibility = getTaskDetailSubtaskButtonVisibility({
        canManageActionChildren: false,
        isPending: false,
        isAddingSubtask: false,
    });
    const addingSubtaskVisibility = getTaskDetailSubtaskButtonVisibility({
        canManageActionChildren: true,
        isPending: false,
        isAddingSubtask: true,
    });
    const pendingSubtaskRowVisibility = getTaskDetailSubtaskButtonVisibility({
        canManageActionChildren: true,
        isPending: true,
        isAddingSubtask: false,
    });
    const readyReminderVisibility = getTaskDetailReminderButtonVisibility({
        canManageActionChildren: true,
        isSavePending: false,
        hasDraftValue: true,
        isPastReminder: false,
    });
    const blockedReminderVisibility = getTaskDetailReminderButtonVisibility({
        canManageActionChildren: true,
        isSavePending: true,
        hasDraftValue: true,
        isPastReminder: false,
    });

    assert.deepEqual(lockedSubtaskVisibility, {
        add: false,
        toggle: false,
        rename: false,
        delete: false,
    });
    assert.deepEqual(addingSubtaskVisibility, {
        add: false,
        toggle: true,
        rename: true,
        delete: true,
    });
    assert.deepEqual(pendingSubtaskRowVisibility, {
        add: true,
        toggle: false,
        rename: false,
        delete: false,
    });
    assert.deepEqual(readyReminderVisibility, {
        add: true,
        remove: true,
    });
    assert.deepEqual(blockedReminderVisibility, {
        add: false,
        remove: false,
    });
});
