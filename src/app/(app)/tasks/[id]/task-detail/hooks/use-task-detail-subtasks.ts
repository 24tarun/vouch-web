import { useCallback, type Dispatch, type FormEvent, type MutableRefObject, type SetStateAction } from "react";
import { addTaskSubtask, deleteTaskSubtask, renameTaskSubtask, toggleTaskSubtask } from "@/actions/tasks";
import { MAX_SUBTASKS_PER_TASK } from "@/lib/constants";
import type { TaskWithRelations } from "@/lib/types";
import { runOptimisticMutation } from "@/lib/ui/runOptimisticMutation";

interface UseTaskDetailSubtasksArgs {
    taskState: TaskWithRelations;
    subtasks: NonNullable<TaskWithRelations["subtasks"]>;
    newSubtaskTitle: string;
    editingSubtaskId: string | null;
    editingSubtaskTitle: string;
    pendingSubtaskIds: Set<string>;
    isAddingSubtask: boolean;
    canManageActionChildren: boolean;
    setSubtasks: Dispatch<SetStateAction<NonNullable<TaskWithRelations["subtasks"]>>>;
    setNewSubtaskTitle: Dispatch<SetStateAction<string>>;
    setSubtaskError: Dispatch<SetStateAction<string | null>>;
    setPendingSubtaskIds: Dispatch<SetStateAction<Set<string>>>;
    setEditingSubtaskId: Dispatch<SetStateAction<string | null>>;
    setEditingSubtaskTitle: Dispatch<SetStateAction<string>>;
    setIsAddingSubtask: Dispatch<SetStateAction<boolean>>;
    shouldRestoreSubtaskInputFocusRef: MutableRefObject<boolean>;
}

export function useTaskDetailSubtasks({
    taskState,
    subtasks,
    newSubtaskTitle,
    editingSubtaskId,
    editingSubtaskTitle,
    pendingSubtaskIds,
    isAddingSubtask,
    canManageActionChildren,
    setSubtasks,
    setNewSubtaskTitle,
    setSubtaskError,
    setPendingSubtaskIds,
    setEditingSubtaskId,
    setEditingSubtaskTitle,
    setIsAddingSubtask,
    shouldRestoreSubtaskInputFocusRef,
}: UseTaskDetailSubtasksArgs) {
    const setSubtaskPending = useCallback((subtaskId: string, pending: boolean) => {
        setPendingSubtaskIds((prev) => {
            const next = new Set(prev);
            if (pending) next.add(subtaskId);
            else next.delete(subtaskId);
            return next;
        });
    }, [setPendingSubtaskIds]);

    const startEditingSubtask = useCallback((subtaskId: string, currentTitle: string) => {
        if (!canManageActionChildren || pendingSubtaskIds.has(subtaskId)) return;
        setSubtaskError(null);
        setEditingSubtaskId(subtaskId);
        setEditingSubtaskTitle(currentTitle);
    }, [canManageActionChildren, pendingSubtaskIds, setEditingSubtaskId, setEditingSubtaskTitle, setSubtaskError]);

    const handleAddSubtask = useCallback(async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!canManageActionChildren || isAddingSubtask) return;

        const normalizedTitle = newSubtaskTitle.trim();
        if (!normalizedTitle) {
            setSubtaskError("Subtask title cannot be empty.");
            return;
        }

        if (subtasks.length >= MAX_SUBTASKS_PER_TASK) {
            setSubtaskError(`You can add up to ${MAX_SUBTASKS_PER_TASK} subtasks.`);
            return;
        }

        setSubtaskError(null);
        setIsAddingSubtask(true);

        const nowIso = new Date().toISOString();
        const optimisticId = `temp-subtask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const optimisticSubtask = {
            id: optimisticId,
            parent_task_id: taskState.id,
            user_id: taskState.user_id,
            title: normalizedTitle,
            is_completed: false,
            completed_at: null,
            created_at: nowIso,
            updated_at: nowIso,
        };

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({ subtasks, newSubtaskTitle }),
            applyOptimistic: () => {
                setSubtasks((prev) => [...prev, optimisticSubtask]);
                setNewSubtaskTitle("");
            },
            runMutation: () => addTaskSubtask(taskState.id, normalizedTitle),
            rollback: (snapshot) => {
                setSubtasks(snapshot.subtasks);
                setNewSubtaskTitle(snapshot.newSubtaskTitle);
            },
            onSuccess: (mutationResult) => {
                if (mutationResult && "subtask" in mutationResult && mutationResult.subtask) {
                    setSubtasks((prev) => prev.map((subtask) => subtask.id === optimisticId ? (mutationResult.subtask as typeof optimisticSubtask) : subtask));
                }
            },
        });

        if (!result.ok && result.error) {
            setSubtaskError(result.error);
        } else if (!result.ok) {
            setSubtaskError("Could not add subtask.");
        } else if (subtasks.length + 1 < MAX_SUBTASKS_PER_TASK) {
            shouldRestoreSubtaskInputFocusRef.current = true;
        }

        setIsAddingSubtask(false);
    }, [
        canManageActionChildren,
        isAddingSubtask,
        newSubtaskTitle,
        setIsAddingSubtask,
        setNewSubtaskTitle,
        setSubtaskError,
        setSubtasks,
        shouldRestoreSubtaskInputFocusRef,
        subtasks,
        taskState.id,
        taskState.user_id,
    ]);

    const handleToggleSubtask = useCallback(async (subtaskId: string) => {
        if (!canManageActionChildren || pendingSubtaskIds.has(subtaskId)) return;

        const current = subtasks.find((subtask) => subtask.id === subtaskId);
        if (!current) return;

        const nextCompleted = !current.is_completed;
        setSubtaskPending(subtaskId, true);
        setSubtaskError(null);

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({ subtasks }),
            applyOptimistic: () => {
                setSubtasks((prev) => prev.map((subtask) =>
                    subtask.id === subtaskId
                        ? {
                            ...subtask,
                            is_completed: nextCompleted,
                            completed_at: nextCompleted ? new Date().toISOString() : null,
                            updated_at: new Date().toISOString(),
                        }
                        : subtask
                ));
            },
            runMutation: () => toggleTaskSubtask(taskState.id, subtaskId, nextCompleted),
            rollback: (snapshot) => {
                setSubtasks(snapshot.subtasks);
            },
        });

        if (!result.ok && result.error) setSubtaskError(result.error);
        setSubtaskPending(subtaskId, false);
    }, [canManageActionChildren, pendingSubtaskIds, setSubtaskError, setSubtaskPending, setSubtasks, subtasks, taskState.id]);

    const handleDeleteSubtask = useCallback(async (subtaskId: string) => {
        if (!canManageActionChildren || pendingSubtaskIds.has(subtaskId)) return;

        setSubtaskPending(subtaskId, true);
        setSubtaskError(null);

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({ subtasks }),
            applyOptimistic: () => {
                setSubtasks((prev) => prev.filter((subtask) => subtask.id !== subtaskId));
            },
            runMutation: () => deleteTaskSubtask(taskState.id, subtaskId),
            rollback: (snapshot) => {
                setSubtasks(snapshot.subtasks);
            },
        });

        if (!result.ok && result.error) setSubtaskError(result.error);
        setSubtaskPending(subtaskId, false);
    }, [canManageActionChildren, pendingSubtaskIds, setSubtaskError, setSubtaskPending, setSubtasks, subtasks, taskState.id]);

    const handleRenameSubtask = useCallback(async () => {
        if (!editingSubtaskId) return;
        const targetId = editingSubtaskId;
        const trimmed = editingSubtaskTitle.trim();
        const currentSubtask = subtasks.find((subtask) => subtask.id === targetId);

        setEditingSubtaskId(null);
        setEditingSubtaskTitle("");

        if (!currentSubtask) return;
        if (!trimmed) {
            setSubtaskError("Subtask title cannot be empty.");
            return;
        }
        if (trimmed === currentSubtask.title) return;

        setSubtaskPending(targetId, true);
        setSubtaskError(null);
        const nowIso = new Date().toISOString();

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({ subtasks }),
            applyOptimistic: () => {
                setSubtasks((prev) => prev.map((subtask) =>
                    subtask.id === targetId ? { ...subtask, title: trimmed, updated_at: nowIso } : subtask
                ));
            },
            runMutation: () => renameTaskSubtask(taskState.id, targetId, trimmed),
            rollback: (snapshot) => {
                setSubtasks(snapshot.subtasks);
            },
            onSuccess: (mutationResult) => {
                if (mutationResult && "subtask" in mutationResult && mutationResult.subtask) {
                    setSubtasks((prev) => prev.map((subtask) =>
                        subtask.id === targetId ? (mutationResult.subtask as typeof subtask) : subtask
                    ));
                }
            },
        });

        if (!result.ok && result.error) setSubtaskError(result.error);
        setSubtaskPending(targetId, false);
    }, [editingSubtaskId, editingSubtaskTitle, setEditingSubtaskId, setEditingSubtaskTitle, setSubtaskError, setSubtaskPending, setSubtasks, subtasks, taskState.id]);

    return {
        setSubtaskPending,
        startEditingSubtask,
        handleAddSubtask,
        handleToggleSubtask,
        handleDeleteSubtask,
        handleRenameSubtask,
    };
}
