"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTask, markTaskCompleted, ownerTempDeleteTask } from "@/actions/tasks";
import { DashboardHeaderActions } from "@/components/DashboardHeaderActions";
import { TaskInput, type TaskInputCreatePayload } from "@/components/TaskInput";
import { TaskRow } from "@/components/TaskRow";
import { CollapsibleCompletedList } from "@/components/CollapsibleCompletedList";
import { runOptimisticMutation } from "@/lib/ui/runOptimisticMutation";
import type { Profile, Task } from "@/lib/types";
import { Lightbulb } from "lucide-react";

const MAX_COMPLETED_TASKS = 10;

function getVoucherResponseDeadlineLocal(baseDate: Date = new Date()): Date {
    const deadline = new Date(baseDate);
    deadline.setDate(deadline.getDate() + 2);
    deadline.setHours(23, 59, 59, 999);
    return deadline;
}

interface DashboardClientProps {
    initialTasks: Task[];
    friends: Profile[];
    defaultFailureCostEuros: string;
    defaultVoucherId: string | null;
    userId: string;
    username: string;
}

function splitTasks(tasks: Task[]) {
    const active = tasks.filter((task) => ["CREATED", "POSTPONED"].includes(task.status));
    const completed = tasks.filter((task) =>
        ["COMPLETED", "AWAITING_VOUCHER", "RECTIFIED", "SETTLED", "FAILED", "DELETED"].includes(task.status)
    );

    return { active, completed };
}

function buildCreateTaskFormData(payload: TaskInputCreatePayload): FormData {
    const formData = new FormData();
    formData.append("title", payload.title);
    formData.append("deadline", payload.deadlineIso);
    formData.append("voucherId", payload.voucherId);
    formData.append("failureCost", payload.failureCost);

    if (payload.recurrenceType) {
        formData.append("recurrenceType", payload.recurrenceType);
        formData.append("userTimezone", payload.userTimezone);
        formData.append("recurrenceInterval", "1");

        if (payload.recurrenceType === "WEEKLY" && payload.recurrenceDays.length > 0) {
            formData.append("recurrenceDays", JSON.stringify(payload.recurrenceDays));
        }
    }

    return formData;
}

export default function DashboardClient({
    initialTasks,
    friends,
    defaultFailureCostEuros,
    defaultVoucherId,
    userId,
    username,
}: DashboardClientProps) {
    const router = useRouter();
    const [, startRefreshTransition] = useTransition();
    const split = useMemo(() => splitTasks(initialTasks), [initialTasks]);

    const [activeTasks, setActiveTasks] = useState<Task[]>(split.active);
    const [completedTasks, setCompletedTasks] = useState<Task[]>(split.completed.slice(0, MAX_COMPLETED_TASKS));
    const [completingTaskIds, setCompletingTaskIds] = useState<Set<string>>(new Set());
    const [deletingTaskIds, setDeletingTaskIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        setActiveTasks(split.active);
        setCompletedTasks(split.completed.slice(0, MAX_COMPLETED_TASKS));
        setCompletingTaskIds((prev) => {
            if (prev.size === 0) return prev;
            const activeIds = new Set(split.active.map((task) => task.id));
            const next = new Set(Array.from(prev).filter((taskId) => activeIds.has(taskId)));
            return next.size === prev.size ? prev : next;
        });
        setDeletingTaskIds((prev) => {
            if (prev.size === 0) return prev;
            const activeIds = new Set(split.active.map((task) => task.id));
            const next = new Set(Array.from(prev).filter((taskId) => activeIds.has(taskId)));
            return next.size === prev.size ? prev : next;
        });
    }, [split]);

    const refreshInBackground = () => {
        startRefreshTransition(() => {
            router.refresh();
        });
    };

    const setTaskCompleting = (taskId: string, completing: boolean) => {
        setCompletingTaskIds((prev) => {
            const next = new Set(prev);
            if (completing) {
                next.add(taskId);
            } else {
                next.delete(taskId);
            }
            return next;
        });
    };

    const setTaskDeleting = (taskId: string, deleting: boolean) => {
        setDeletingTaskIds((prev) => {
            const next = new Set(prev);
            if (deleting) {
                next.add(taskId);
            } else {
                next.delete(taskId);
            }
            return next;
        });
    };

    const handleCreateTaskOptimistic = (payload: TaskInputCreatePayload) => {
        const nowIso = new Date().toISOString();
        const tempTaskId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const optimisticTask: Task = {
            id: tempTaskId,
            user_id: userId,
            voucher_id: payload.voucherId,
            title: payload.title,
            description: null,
            failure_cost_cents: Math.round(Number(payload.failureCost) * 100),
            deadline: payload.deadlineIso,
            status: "CREATED",
            postponed_at: null,
            marked_completed_at: null,
            voucher_response_deadline: null,
            recurrence_rule_id: payload.recurrenceType ? "optimistic" : null,
            created_at: nowIso,
            updated_at: nowIso,
        };

        void runOptimisticMutation({
            captureSnapshot: () => ({
                activeTasks,
                completedTasks,
            }),
            applyOptimistic: () => {
                setActiveTasks((prev) => [optimisticTask, ...prev]);
            },
            runMutation: () => createTask(buildCreateTaskFormData(payload)),
            rollback: (snapshot) => {
                setActiveTasks(snapshot.activeTasks);
                setCompletedTasks(snapshot.completedTasks);
            },
            onSuccess: (result) => {
                if (result && "taskId" in result && result.taskId) {
                    setActiveTasks((prev) =>
                        prev.map((task) =>
                            task.id === tempTaskId
                                ? { ...task, id: result.taskId as string, recurrence_rule_id: payload.recurrenceType ? task.recurrence_rule_id : null }
                                : task
                        )
                    );
                }
                refreshInBackground();
            },
        });
    };

    const handleCompleteTaskOptimistic = async (task: Task) => {
        if (completingTaskIds.has(task.id)) return;
        setTaskCompleting(task.id, true);

        const now = new Date();
        const voucherResponseDeadline = getVoucherResponseDeadlineLocal(now);
        const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        const nowIso = now.toISOString();
        const optimisticTask: Task = {
            ...task,
            status: "AWAITING_VOUCHER",
            marked_completed_at: nowIso,
            voucher_response_deadline: voucherResponseDeadline.toISOString(),
            updated_at: nowIso,
        };

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({
                activeTasks,
                completedTasks,
            }),
            applyOptimistic: () => {
                setActiveTasks((prev) => prev.filter((currentTask) => currentTask.id !== task.id));
                setCompletedTasks((prev) =>
                    [optimisticTask, ...prev.filter((currentTask) => currentTask.id !== task.id)].slice(0, MAX_COMPLETED_TASKS)
                );
            },
            runMutation: () => markTaskCompleted(task.id, userTimeZone),
            rollback: (snapshot) => {
                setActiveTasks(snapshot.activeTasks);
                setCompletedTasks(snapshot.completedTasks);
            },
            onSuccess: () => {
                refreshInBackground();
            },
        });

        if (!result.ok) {
            refreshInBackground();
        }

        setTaskCompleting(task.id, false);
    };

    const handleDeleteTaskOptimistic = async (task: Task) => {
        if (deletingTaskIds.has(task.id) || task.id.startsWith("temp-")) return;
        setTaskDeleting(task.id, true);

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({
                activeTasks,
                completedTasks,
            }),
            applyOptimistic: () => {
                setActiveTasks((prev) => prev.filter((currentTask) => currentTask.id !== task.id));
                setCompletedTasks((prev) => prev.filter((currentTask) => currentTask.id !== task.id));
            },
            runMutation: () => ownerTempDeleteTask(task.id),
            rollback: (snapshot) => {
                setActiveTasks(snapshot.activeTasks);
                setCompletedTasks(snapshot.completedTasks);
            },
            onSuccess: () => {
                refreshInBackground();
            },
        });

        if (!result.ok) {
            refreshInBackground();
        }

        setTaskDeleting(task.id, false);
    };

    return (
        <div className="max-w-3xl mx-auto space-y-6 px-4 md:px-0 pb-14">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl font-bold text-white flex items-center gap-2">{`Hi ${username}`}</h1>
                <DashboardHeaderActions />
            </div>

            <TaskInput
                friends={friends}
                defaultFailureCostEuros={defaultFailureCostEuros}
                defaultVoucherId={defaultVoucherId}
                onCreateTaskOptimistic={handleCreateTaskOptimistic}
            />
            <p className="px-1 text-[10px] text-slate-400 font-mono uppercase tracking-wider flex items-center gap-1.5">
                <Lightbulb className="h-3 w-3 shrink-0 text-yellow-400" />
                Ticking the task off will instantly mark it as completed.
            </p>
            <p className="px-1 text-[10px] text-slate-400 font-mono uppercase tracking-wider flex items-center gap-1.5">
                <Lightbulb className="h-3 w-3 shrink-0 text-yellow-400" />
                a new task can be deleted within 5 mins
            </p>

            <div className="flex flex-col">
                {activeTasks.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-slate-500 text-sm">All tasks completed! Relax or add more.</p>
                    </div>
                ) : (
                    activeTasks.map((task) => (
                        <TaskRow
                            key={task.id}
                            task={task}
                            onComplete={handleCompleteTaskOptimistic}
                            isCompleting={completingTaskIds.has(task.id)}
                            onDelete={handleDeleteTaskOptimistic}
                            isDeleting={deletingTaskIds.has(task.id)}
                        />
                    ))
                )}
            </div>

            {completedTasks.length > 0 && (
                <CollapsibleCompletedList tasks={completedTasks} />
            )}
        </div>
    );
}
