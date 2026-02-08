"use client";

import { type Dispatch, type SetStateAction, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markTaskCompleted, ownerTempDeleteTask, postponeTask } from "@/actions/tasks";
import { runOptimisticMutation } from "@/lib/ui/runOptimisticMutation";
import type { Task } from "@/lib/types";
import { CompactStatsItem } from "@/components/CompactStatsItem";
import { usePomodoro } from "@/components/PomodoroProvider";
import { DEFAULT_POMO_DURATION_MINUTES } from "@/lib/constants";

type StatsTask = Task & { pomo_total_seconds?: number };
const ACTIVE_SECTION_STATUSES = new Set(["CREATED", "POSTPONED", "AWAITING_VOUCHER", "MARKED_COMPLETED"]);

interface StatsActiveTaskListProps {
    initialTasks: StatsTask[];
    defaultPomoDurationMinutes: number;
}

function normalizePomoDuration(value: number): number {
    return Number.isInteger(value) && value >= 1 && value <= 720
        ? value
        : DEFAULT_POMO_DURATION_MINUTES;
}

export function StatsActiveTaskList({
    initialTasks,
    defaultPomoDurationMinutes,
}: StatsActiveTaskListProps) {
    const router = useRouter();
    const [, startRefreshTransition] = useTransition();
    const { startSession } = usePomodoro();
    const userTimeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
    const normalizedDefaultPomoDuration = normalizePomoDuration(defaultPomoDurationMinutes);

    const [tasks, setTasks] = useState<StatsTask[]>(initialTasks);
    const [completingTaskIds, setCompletingTaskIds] = useState<Set<string>>(new Set());
    const [postponingTaskIds, setPostponingTaskIds] = useState<Set<string>>(new Set());
    const [deletingTaskIds, setDeletingTaskIds] = useState<Set<string>>(new Set());
    const [startingPomoTaskIds, setStartingPomoTaskIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        setTasks(initialTasks.filter((task) => ACTIVE_SECTION_STATUSES.has(task.status)));
    }, [initialTasks]);

    const refreshInBackground = () => {
        startRefreshTransition(() => {
            router.refresh();
        });
    };

    const setPendingForTask = (
        setPending: Dispatch<SetStateAction<Set<string>>>,
        taskId: string,
        pending: boolean
    ) => {
        setPending((prev) => {
            const next = new Set(prev);
            if (pending) {
                next.add(taskId);
            } else {
                next.delete(taskId);
            }
            return next;
        });
    };

    const handleComplete = async (task: StatsTask) => {
        if (completingTaskIds.has(task.id)) return;
        setPendingForTask(setCompletingTaskIds, task.id, true);

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({ tasks }),
            applyOptimistic: () => {
                setTasks((prev) => prev.filter((currentTask) => currentTask.id !== task.id));
            },
            runMutation: () => markTaskCompleted(task.id, userTimeZone),
            rollback: (snapshot) => {
                setTasks(snapshot.tasks);
            },
            onSuccess: () => {
                refreshInBackground();
            },
            getFailureMessage: (mutationResult) => mutationResult.error || null,
            fallbackErrorMessage: "Could not mark task complete.",
        });

        if (!result.ok) {
            refreshInBackground();
        }

        setPendingForTask(setCompletingTaskIds, task.id, false);
    };

    const handlePostpone = async (task: StatsTask) => {
        if (postponingTaskIds.has(task.id)) return;
        setPendingForTask(setPostponingTaskIds, task.id, true);

        const optimisticUpdatedAt = new Date().toISOString();
        const optimisticDeadlineIso = new Date(new Date(task.deadline).getTime() + 60 * 60 * 1000).toISOString();

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({ tasks }),
            applyOptimistic: () => {
                setTasks((prev) =>
                    prev.map((currentTask) =>
                        currentTask.id === task.id
                            ? {
                                ...currentTask,
                                status: "POSTPONED",
                                deadline: optimisticDeadlineIso,
                                postponed_at: optimisticUpdatedAt,
                                updated_at: optimisticUpdatedAt,
                            }
                            : currentTask
                    )
                );
            },
            runMutation: () => postponeTask(task.id, optimisticDeadlineIso),
            rollback: (snapshot) => {
                setTasks(snapshot.tasks);
            },
            onSuccess: () => {
                refreshInBackground();
            },
            getFailureMessage: (mutationResult) => mutationResult.error || null,
            fallbackErrorMessage: "Could not postpone task.",
        });

        if (!result.ok) {
            refreshInBackground();
        }

        setPendingForTask(setPostponingTaskIds, task.id, false);
    };

    const handleDelete = async (task: StatsTask) => {
        if (deletingTaskIds.has(task.id) || task.id.startsWith("temp-")) return;
        setPendingForTask(setDeletingTaskIds, task.id, true);

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({ tasks }),
            applyOptimistic: () => {
                setTasks((prev) => prev.filter((currentTask) => currentTask.id !== task.id));
            },
            runMutation: () => ownerTempDeleteTask(task.id),
            rollback: (snapshot) => {
                setTasks(snapshot.tasks);
            },
            onSuccess: () => {
                refreshInBackground();
            },
            getFailureMessage: (mutationResult) => mutationResult.error || null,
            fallbackErrorMessage: "Could not delete task.",
        });

        if (!result.ok) {
            refreshInBackground();
        }

        setPendingForTask(setDeletingTaskIds, task.id, false);
    };

    const handleQuickPomo = async (task: StatsTask) => {
        if (startingPomoTaskIds.has(task.id)) return;
        setPendingForTask(setStartingPomoTaskIds, task.id, true);
        try {
            await startSession(task.id, normalizedDefaultPomoDuration);
        } finally {
            setPendingForTask(setStartingPomoTaskIds, task.id, false);
        }
    };

    return (
        <>
            {tasks
                .filter((task) => ACTIVE_SECTION_STATUSES.has(task.status))
                .map((task) => (
                <CompactStatsItem
                    key={task.id}
                    task={task}
                    showQuickActions
                    onComplete={handleComplete}
                    onPostpone={handlePostpone}
                    onQuickPomo={handleQuickPomo}
                    onDelete={handleDelete}
                    isCompleting={completingTaskIds.has(task.id)}
                    isPostponing={postponingTaskIds.has(task.id)}
                    isDeleting={deletingTaskIds.has(task.id)}
                    isStartingPomo={startingPomoTaskIds.has(task.id)}
                    defaultPomoDurationMinutes={normalizedDefaultPomoDuration}
                />
                ))}
        </>
    );
}
