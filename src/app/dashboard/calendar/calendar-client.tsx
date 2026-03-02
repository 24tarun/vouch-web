"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postponeTask } from "@/actions/tasks";
import { TaskInput } from "@/components/TaskInput";
import { TaskCalendar, type CalendarView } from "@/components/ui/task-calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { mapTasksToCalendarEvents } from "@/lib/calendar/task-calendar-map";
import { resolveTaskWindow } from "@/lib/tasks/time-model";
import { runOptimisticMutation } from "@/lib/ui/runOptimisticMutation";
import type { SupportedCurrency } from "@/lib/currency";
import type { Profile, Task } from "@/lib/types";
import { toast } from "sonner";

interface CalendarClientProps {
    initialTasks: Task[];
    friends: Profile[];
    userId: string;
    defaultFailureCostEuros: string;
    defaultCurrency: SupportedCurrency;
    defaultVoucherId: string | null;
    defaultEventDurationMinutes: number;
}

function isRescheduleEligible(task: Task): boolean {
    if (task.status !== "CREATED") return false;
    if (task.postponed_at) return false;

    const window = resolveTaskWindow(task);
    if (!window) return false;
    return window.endAt.getTime() > Date.now();
}

function roundUpToNextThirtyMinutes(baseDate: Date): Date {
    const rounded = new Date(baseDate);
    rounded.setSeconds(0, 0);
    const minutes = rounded.getMinutes();
    const remainder = minutes % 30;
    const addMinutes = remainder === 0 ? 30 : 30 - remainder;
    rounded.setMinutes(minutes + addMinutes);
    return rounded;
}

function buildPrefillDate(slotDate: Date, view: CalendarView): Date {
    const normalized = new Date(slotDate);
    normalized.setSeconds(0, 0);

    if (view === "month" || view === "list") {
        const roundedNow = roundUpToNextThirtyMinutes(new Date());
        normalized.setHours(roundedNow.getHours(), roundedNow.getMinutes(), 0, 0);
    }

    return normalized;
}

function buildOptimisticPostponedTask(task: Task, inputDate: Date, nowIso: string): Task {
    const resolved = resolveTaskWindow(task);
    if (!resolved) return task;

    let nextStartIso: string | null = null;
    let nextDeadlineIso = inputDate.toISOString();
    if (resolved.isTimed && resolved.startAt) {
        const durationMs = resolved.endAt.getTime() - resolved.startAt.getTime();
        const nextStart = inputDate;
        const nextEnd = new Date(nextStart.getTime() + durationMs);
        nextStartIso = nextStart.toISOString();
        nextDeadlineIso = nextEnd.toISOString();
    }

    return {
        ...task,
        status: "POSTPONED",
        start_at: nextStartIso,
        deadline: nextDeadlineIso,
        google_event_end_at: null,
        postponed_at: nowIso,
        updated_at: nowIso,
    };
}

export default function CalendarClient({
    initialTasks,
    friends,
    userId,
    defaultFailureCostEuros,
    defaultCurrency,
    defaultVoucherId,
    defaultEventDurationMinutes,
}: CalendarClientProps) {
    const router = useRouter();
    const [tasks, setTasks] = useState<Task[]>(initialTasks);
    const [prefillStartIso, setPrefillStartIso] = useState<string | null>(null);
    const [prefillDeadlineIso, setPrefillDeadlineIso] = useState<string | null>(null);
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [reschedulingTaskIds, setReschedulingTaskIds] = useState<Set<string>>(new Set());
    const [, startRefreshTransition] = useTransition();

    useEffect(() => {
        setTasks(initialTasks);
    }, [initialTasks]);

    const calendarEvents = useMemo(() => mapTasksToCalendarEvents(tasks), [tasks]);
    const taskById = useMemo(() => {
        return tasks.reduce((map, task) => {
            map.set(task.id, task);
            return map;
        }, new Map<string, Task>());
    }, [tasks]);

    const refreshInBackground = () => {
        startRefreshTransition(() => {
            router.refresh();
        });
    };

    const setTaskRescheduling = (taskId: string, rescheduling: boolean) => {
        setReschedulingTaskIds((prev) => {
            const next = new Set(prev);
            if (rescheduling) {
                next.add(taskId);
            } else {
                next.delete(taskId);
            }
            return next;
        });
    };

    const handleCreateFromSlot = (slotDate: Date, view: CalendarView) => {
        const prefillBase = buildPrefillDate(slotDate, view);
        const prefillDeadline = new Date(prefillBase.getTime() + defaultEventDurationMinutes * 60 * 1000);
        setPrefillStartIso(prefillBase.toISOString());
        setPrefillDeadlineIso(prefillDeadline.toISOString());
        setIsCreateDialogOpen(true);
    };

    const handleReschedule = async (taskId: string, inputDate: Date) => {
        const task = taskById.get(taskId);
        if (!task) {
            toast.error("Task not found. Please refresh.");
            return;
        }

        if (!isRescheduleEligible(task)) {
            toast.error("Only future, non-postponed CREATED tasks can be moved.");
            return;
        }

        const shouldProceed = window.confirm("this action will use your onetime postpone pass");
        if (!shouldProceed) {
            return;
        }

        if (reschedulingTaskIds.has(taskId)) return;

        setTaskRescheduling(taskId, true);
        const nowIso = new Date().toISOString();
        const optimisticInputIso = inputDate.toISOString();

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({ tasks }),
            applyOptimistic: () => {
                setTasks((prev) =>
                    prev.map((currentTask) =>
                        currentTask.id === taskId
                            ? buildOptimisticPostponedTask(currentTask, inputDate, nowIso)
                            : currentTask
                    )
                );
            },
            runMutation: () => postponeTask(taskId, optimisticInputIso),
            rollback: (snapshot) => {
                setTasks(snapshot.tasks);
            },
            onSuccess: () => {
                toast.success("Task moved.");
                refreshInBackground();
            },
            fallbackErrorMessage: "Could not move task.",
        });

        if (!result.ok) {
            console.error("Failed to reschedule task from calendar:", result.error);
            refreshInBackground();
        }

        setTaskRescheduling(taskId, false);
    };

    const handleOpenTask = (taskId: string) => {
        router.push(`/dashboard/tasks/${taskId}`);
    };

    return (
        <div className="relative -mx-4 -mt-4 w-[calc(100%+2rem)] space-y-4 px-2 sm:-mx-6 sm:-mt-4 sm:w-[calc(100%+3rem)] sm:px-3 lg:-mx-8 lg:-mt-4 lg:w-[calc(100%+4rem)] lg:px-4">
            <TaskCalendar
                events={calendarEvents}
                defaultView="week"
                onCreateFromSlot={handleCreateFromSlot}
                onReschedule={handleReschedule}
                onOpenTask={handleOpenTask}
            />

            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                <DialogContent className="max-w-4xl border-white/15 bg-slate-950 text-slate-200">
                    <DialogHeader>
                        <DialogTitle className="text-white">Create task</DialogTitle>
                    </DialogHeader>

                    <TaskInput
                        friends={friends}
                        defaultFailureCostEuros={defaultFailureCostEuros}
                        defaultCurrency={defaultCurrency}
                        defaultVoucherId={defaultVoucherId}
                        defaultEventDurationMinutes={defaultEventDurationMinutes}
                        selfUserId={userId}
                        prefillStartIso={prefillStartIso}
                        prefillDeadlineIso={prefillDeadlineIso}
                        onCreated={() => {
                            setIsCreateDialogOpen(false);
                            refreshInBackground();
                        }}
                    />
                </DialogContent>
            </Dialog>
        </div>
    );
}
