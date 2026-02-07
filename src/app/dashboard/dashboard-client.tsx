"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTask, markTaskCompleted } from "@/actions/tasks";
import { DashboardHeaderActions } from "@/components/DashboardHeaderActions";
import { TaskInput, type TaskInputCreatePayload } from "@/components/TaskInput";
import { TaskRow } from "@/components/TaskRow";
import { CollapsibleCompletedList } from "@/components/CollapsibleCompletedList";
import { runOptimisticMutation } from "@/lib/ui/runOptimisticMutation";
import type { Profile, Task } from "@/lib/types";

const MAX_COMPLETED_TASKS = 10;

interface DashboardClientProps {
    initialTasks: Task[];
    friends: Profile[];
    defaultFailureCostEuros: string;
    defaultVoucherId: string | null;
    userId: string;
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
}: DashboardClientProps) {
    const router = useRouter();
    const [, startRefreshTransition] = useTransition();
    const split = splitTasks(initialTasks);

    const [activeTasks, setActiveTasks] = useState<Task[]>(split.active);
    const [completedTasks, setCompletedTasks] = useState<Task[]>(split.completed.slice(0, MAX_COMPLETED_TASKS));
    const [completingTaskIds, setCompletingTaskIds] = useState<Set<string>>(new Set());

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
        const voucherResponseDeadline = new Date(now);
        voucherResponseDeadline.setDate(voucherResponseDeadline.getDate() + 7);
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
            runMutation: () => markTaskCompleted(task.id),
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

    return (
        <div className="max-w-3xl mx-auto space-y-6 px-4 md:px-0">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl font-bold text-white flex items-center gap-2">Inbox</h1>
                <DashboardHeaderActions />
            </div>

            <TaskInput
                friends={friends}
                defaultFailureCostEuros={defaultFailureCostEuros}
                defaultVoucherId={defaultVoucherId}
                onCreateTaskOptimistic={handleCreateTaskOptimistic}
            />

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
