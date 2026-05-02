import { useCallback, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { toast } from "sonner";
import { replaceTaskReminders } from "@/actions/tasks";
import type { TaskWithRelations } from "@/lib/types";
import { localDateTimeToIso } from "@/lib/datetime-local";
import { runOptimisticMutation } from "@/lib/ui/runOptimisticMutation";
import { MANUAL_REMINDER_SOURCE } from "@/lib/task-reminder-defaults";
import { normalizeReminderIsos, splitRemindersByTime, toReminderIso } from "@/app/(app)/tasks/[id]/task-detail/utils/task-detail-helpers";

interface UseTaskDetailRemindersArgs {
    reminders: NonNullable<TaskWithRelations["reminders"]>;
    taskState: TaskWithRelations;
    newReminderLocal: string;
    setReminders: Dispatch<SetStateAction<NonNullable<TaskWithRelations["reminders"]>>>;
    setTaskState: Dispatch<SetStateAction<TaskWithRelations>>;
    setNewReminderLocal: Dispatch<SetStateAction<string>>;
    canManageActionChildren: boolean;
    isActionPending: (action: string) => boolean;
    setActionPending: (action: string, pending: boolean) => void;
    refreshInBackground: () => void;
}

export function useTaskDetailReminders({
    reminders,
    taskState,
    newReminderLocal,
    setReminders,
    setTaskState,
    setNewReminderLocal,
    canManageActionChildren,
    isActionPending,
    setActionPending,
    refreshInBackground,
}: UseTaskDetailRemindersArgs) {
    const splitCurrentRemindersByTime = useCallback(
        (referenceNowMs: number) => splitRemindersByTime(reminders || [], referenceNowMs),
        [reminders]
    );

    const getCurrentFutureReminderIsos = useCallback(
        (referenceNowMs: number = Date.now()) =>
            normalizeReminderIsos(
                splitCurrentRemindersByTime(referenceNowMs).futureReminders.map((reminder) => reminder.reminder_at)
            ),
        [splitCurrentRemindersByTime]
    );

    const hasInvalidFutureReminderForTask = useCallback(
        (futureReminderIsos: string[]) => {
            const deadlineDate = new Date(taskState.deadline);
            return futureReminderIsos.some((reminderIso) => {
                const reminderDate = new Date(reminderIso);
                return reminderDate.getTime() <= Date.now() || reminderDate.getTime() > deadlineDate.getTime();
            });
        },
        [taskState.deadline]
    );

    const saveReminderSet = useCallback(async (futureReminderIsos: string[], clearReminderInput: boolean) => {
        if (isActionPending("saveReminders")) return { ok: false as const };
        if (!canManageActionChildren) {
            toast.error("Reminders can only be edited for active tasks.");
            return { ok: false as const };
        }

        if (hasInvalidFutureReminderForTask(futureReminderIsos)) {
            toast.error("All reminders must be in the future and before or at the deadline.");
            return { ok: false as const };
        }

        setActionPending("saveReminders", true);
        const nowIso = new Date().toISOString();

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({ reminders, taskState, newReminderLocal }),
            applyOptimistic: () => {
                const referenceNowMs = Date.now();
                const { pastReminders } = splitCurrentRemindersByTime(referenceNowMs);
                const existingByIso = new Map<string, (typeof reminders)[number]>();
                for (const reminder of reminders || []) {
                    const normalizedIso = toReminderIso(reminder.reminder_at);
                    if (!normalizedIso) continue;
                    existingByIso.set(normalizedIso, reminder);
                }

                const optimisticFutureReminders = futureReminderIsos.map((reminderIso, index) => {
                    const existingReminder = existingByIso.get(reminderIso);
                    if (existingReminder) {
                        return {
                            ...existingReminder,
                            reminder_at: reminderIso,
                        };
                    }

                    return {
                        id: `temp-reminder-${index}-${Math.random().toString(36).slice(2, 8)}`,
                        parent_task_id: taskState.id,
                        user_id: taskState.user_id,
                        reminder_at: reminderIso,
                        source: MANUAL_REMINDER_SOURCE,
                        notified_at: null,
                        created_at: nowIso,
                        updated_at: nowIso,
                    };
                });

                const optimisticReminders = [...pastReminders, ...optimisticFutureReminders].sort(
                    (a, b) => new Date(a.reminder_at).getTime() - new Date(b.reminder_at).getTime()
                );
                setReminders(optimisticReminders);
                setTaskState((prev) => ({
                    ...prev,
                    reminders: optimisticReminders,
                }));
                if (clearReminderInput) {
                    setNewReminderLocal("");
                }
            },
            runMutation: () => replaceTaskReminders(taskState.id, futureReminderIsos),
            rollback: (snapshot) => {
                setReminders(snapshot.reminders);
                setTaskState(snapshot.taskState);
                setNewReminderLocal(snapshot.newReminderLocal);
            },
            getFailureMessage: (mutationResult) => mutationResult.error || null,
            fallbackErrorMessage: "Could not save reminders.",
            onSuccess: () => {
                refreshInBackground();
            },
        });

        if (!result.ok) {
            refreshInBackground();
        }

        setActionPending("saveReminders", false);
        return result;
    }, [
        canManageActionChildren,
        hasInvalidFutureReminderForTask,
        isActionPending,
        newReminderLocal,
        refreshInBackground,
        reminders,
        setActionPending,
        setNewReminderLocal,
        setReminders,
        setTaskState,
        splitCurrentRemindersByTime,
        taskState,
    ]);

    const handleAddReminder = useCallback(async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!canManageActionChildren || isActionPending("saveReminders")) return;
        if (!newReminderLocal.trim()) return;

        const reminderIso = localDateTimeToIso(newReminderLocal.trim());
        if (!reminderIso) {
            toast.error("Please choose a valid reminder.");
            return;
        }

        const reminderDate = new Date(reminderIso);
        const deadlineDate = new Date(taskState.deadline);
        const now = Date.now();
        if (reminderDate.getTime() <= now) {
            toast.error("Reminder must be in the future.");
            return;
        }
        if (reminderDate.getTime() > deadlineDate.getTime()) {
            toast.error("Reminder must be before or at the deadline.");
            return;
        }

        const nextFutureReminderIsos = normalizeReminderIsos([
            ...getCurrentFutureReminderIsos(now),
            reminderIso,
        ]);
        await saveReminderSet(nextFutureReminderIsos, true);
    }, [
        canManageActionChildren,
        getCurrentFutureReminderIsos,
        isActionPending,
        newReminderLocal,
        saveReminderSet,
        taskState.deadline,
    ]);

    const handleRemoveReminder = useCallback(async (reminderIso: string) => {
        if (!canManageActionChildren || isActionPending("saveReminders")) return;
        const reminderMs = new Date(reminderIso).getTime();
        if (!Number.isNaN(reminderMs) && reminderMs <= Date.now()) {
            toast.info("Past reminders are kept as history.");
            return;
        }
        const nextFutureReminderIsos = getCurrentFutureReminderIsos().filter((value) => value !== reminderIso);
        await saveReminderSet(nextFutureReminderIsos, false);
    }, [canManageActionChildren, getCurrentFutureReminderIsos, isActionPending, saveReminderSet]);

    return {
        handleAddReminder,
        handleRemoveReminder,
    };
}
