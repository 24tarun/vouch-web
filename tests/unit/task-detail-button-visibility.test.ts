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
        isBeforeStart: false,
        incompleteSubtasksCount: 0,
        hasIncompletePomoRequirement: false,
        hasRunningPomoForTask: false,
        hasPostponedAt: false,
        hasRecurrenceRule: true,
        isRepetitionStopped: false,
        canUseOverride: false,
        canTempDelete: true,
        canResubmit: false,
        escalationPending: false,
    });

    /*
     * What and why this test checks:
     * This verifies the shared top-level visibility policy for the most common owner-active state, where
     * the task detail page should show only actionable controls instead of rendering disabled buttons.
     *
     * Passing scenario:
     * An active owner sees the full actionable set for focus, proof, completion, postpone, recurrence,
     * delete, and section toggles, while override stays hidden because it is not actionable.
     *
     * Failing scenario:
     * If any unavailable control still appears here or an actionable control disappears, the task detail
     * screen will drift away from the new hide-instead-of-disable contract.
     */
    assert.deepEqual(visibility.actions, {
        pomo: true,
        attachProof: true,
        markComplete: true,
        postpone: true,
        pauseRepetition: true,
        cancelRepetition: true,
        override: false,
        tempDelete: true,
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
        isBeforeStart: false,
        incompleteSubtasksCount: 0,
        hasIncompletePomoRequirement: false,
        hasRunningPomoForTask: false,
        hasPostponedAt: false,
        hasRecurrenceRule: true,
        isRepetitionStopped: false,
        canUseOverride: false,
        canTempDelete: false,
        canResubmit: false,
        escalationPending: false,
    });

    /*
     * What and why this test checks:
     * This locks the owner-only rule for shared task detail rendering across web and mobile wrappers.
     *
     * Passing scenario:
     * A non-owner sees no owner-only main actions, no awaiting actions, and no proof-removal control.
     *
     * Failing scenario:
     * If any of these remain visible for non-owners, the page will still behave like the old disabled-button
     * design and expose controls that should now disappear.
     */
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
        subtasksToggle: false,
        remindersToggle: false,
    });
});

test("historical owners can pause or stop a surviving recurrence rule", () => {
    const visibility = getTaskDetailButtonVisibility({
        status: "ACCEPTED",
        pendingActions: [],
        isOwner: true,
        isActiveParentTask: false,
        isOverdue: false,
        isBeforeStart: false,
        incompleteSubtasksCount: 0,
        hasIncompletePomoRequirement: false,
        hasRunningPomoForTask: false,
        hasPostponedAt: false,
        hasRecurrenceRule: true,
        isRepetitionStopped: false,
        canUseOverride: false,
        canTempDelete: false,
        canResubmit: false,
        escalationPending: false,
    });

    assert.equal(visibility.actions.pauseRepetition, true);
    assert.equal(visibility.actions.cancelRepetition, true);
    assert.equal(visibility.actions.markComplete, false);
});

test("awaiting owner actions disappear when pending or when undo complete is blocked after deadline", () => {
    const visibility = getTaskDetailButtonVisibility({
        status: "AWAITING_VOUCHER",
        pendingActions: ["awaitingProofUpload", "undoComplete", "removeStoredProof"],
        isOwner: true,
        isActiveParentTask: false,
        isOverdue: true,
        isBeforeStart: false,
        incompleteSubtasksCount: 0,
        hasIncompletePomoRequirement: false,
        hasRunningPomoForTask: false,
        hasPostponedAt: false,
        hasRecurrenceRule: false,
        isRepetitionStopped: false,
        canUseOverride: false,
        canTempDelete: false,
        canResubmit: false,
        escalationPending: false,
    });

    /*
     * What and why this test checks:
     * This verifies the specific awaiting-state regression the user called out, including hiding buttons
     * during in-flight proof actions and after undo-complete becomes invalid past the deadline.
     *
     * Passing scenario:
     * Pending add-proof, pending undo-complete, and pending remove-proof controls all resolve to hidden.
     *
     * Failing scenario:
     * If any of these stay visible while blocked, the task detail page would still render disabled awaiting
     * controls instead of removing them.
     */
    assert.equal(visibility.awaiting.addProof, false);
    assert.equal(visibility.awaiting.undoComplete, false);
    assert.equal(visibility.proof.removeStored, false);
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

    /*
     * What and why this test checks:
     * This covers the nested editor controls inside task detail sections, which also need to follow the
     * hide-instead-of-disable rule for add, toggle, rename, delete, and reminder removal actions.
     *
     * Passing scenario:
     * Locked subtask controls all evaluate to hidden, the add-subtask button hides while its own request is
     * pending, row-level subtask controls hide while that row is pending, and a ready reminder action renders
     * before hiding again once reminder saving is pending.
     *
     * Failing scenario:
     * If locked or pending nested controls still evaluate to visible, expanded task detail sections will
     * continue showing disabled buttons after the main action grid has been cleaned up.
     */
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
