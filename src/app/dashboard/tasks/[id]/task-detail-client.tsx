"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markTaskComplete, postponeTask, forceMajeureTask, cancelRepetition } from "@/actions/tasks";
import { Button } from "@/components/ui/button";
import { Repeat } from "lucide-react";
import { toast } from "sonner";

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TaskWithRelations, TaskEvent } from "@/lib/types";
import { PomoButton } from "@/components/ui/PomoButton";
import { isIOS } from "@/lib/platform";
import {
    combineDateAndTime,
    fromDateTimeLocalValue,
    getDatePartFromLocalDateTime,
    getTimePartFromLocalDateTime,
    localDateTimeToIso,
    toDateTimeLocalValue,
} from "@/lib/datetime-local";
import { runOptimisticMutation } from "@/lib/ui/runOptimisticMutation";

interface TaskDetailClientProps {
    task: TaskWithRelations;
    events: TaskEvent[];
    pomoSummary: {
        totalSeconds: number;
        sessionCount: number;
        completedSessions: number;
        lastCompletedAt: string | null;
    } | null;
    defaultPomoDurationMinutes: number;
}

const VOUCHER_RESPONSE_WINDOW_HOURS = 48;

export default function TaskDetailClient({
    task,
    events,
    pomoSummary,
    defaultPomoDurationMinutes,
}: TaskDetailClientProps) {
    const router = useRouter();
    const [, startRefreshTransition] = useTransition();
    const isIOSDevice = isIOS();
    const [taskState, setTaskState] = useState<TaskWithRelations>(task);
    const [postponeOpen, setPostponeOpen] = useState(false);
    const [isRepetitionStopped, setIsRepetitionStopped] = useState(task.recurrence_rule?.active === false);
    const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());

    const deadline = new Date(taskState.deadline);
    const isOverdue =
        deadline < new Date() &&
        !["COMPLETED", "FAILED", "RECTIFIED", "SETTLED"].includes(taskState.status);

    const maxPostpone = new Date(deadline.getTime() + 60 * 60 * 1000);
    const minPostpone = new Date(deadline.getTime() + 60 * 1000);
    const minPostponeLocal = toDateTimeLocalValue(minPostpone);
    const maxPostponeLocal = toDateTimeLocalValue(maxPostpone);

    const [postponeValue, setPostponeValue] = useState(maxPostponeLocal);
    const [postponeDate, setPostponeDate] = useState(() => getDatePartFromLocalDateTime(maxPostponeLocal));
    const [postponeTime, setPostponeTime] = useState(() => getTimePartFromLocalDateTime(maxPostponeLocal));
    const hasPomoData = (pomoSummary?.sessionCount || 0) > 0;

    const refreshInBackground = () => {
        startRefreshTransition(() => {
            router.refresh();
        });
    };

    const setActionPending = (action: string, pending: boolean) => {
        setPendingActions((prev) => {
            const next = new Set(prev);
            if (pending) {
                next.add(action);
            } else {
                next.delete(action);
            }
            return next;
        });
    };

    const isActionPending = (action: string) => pendingActions.has(action);

    const resetPostponeDraft = () => {
        const latestDeadline = new Date(taskState.deadline);
        const latestMaxPostpone = new Date(latestDeadline.getTime() + 60 * 60 * 1000);
        const latestMaxLocal = toDateTimeLocalValue(latestMaxPostpone);

        setPostponeValue(latestMaxLocal);
        setPostponeDate(getDatePartFromLocalDateTime(latestMaxLocal));
        setPostponeTime(getTimePartFromLocalDateTime(latestMaxLocal));
    };

    const handlePostponeOpenChange = (open: boolean) => {
        setPostponeOpen(open);
        if (open) {
            resetPostponeDraft();
        }
    };

    const handlePostponeDateChange = (value: string) => {
        setPostponeDate(value);
        const combined = combineDateAndTime(value, postponeTime);
        if (combined) {
            setPostponeValue(combined);
        }
    };

    const handlePostponeTimeChange = (value: string) => {
        setPostponeTime(value);
        const combined = combineDateAndTime(postponeDate, value);
        if (combined) {
            setPostponeValue(combined);
        }
    };

    const statusColors: Record<string, string> = {
        CREATED: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
        POSTPONED: "bg-amber-500/20 text-amber-300 border border-amber-500/30",
        MARKED_COMPLETED: "bg-purple-500/20 text-purple-300 border border-purple-500/30",
        AWAITING_VOUCHER: "bg-purple-500/20 text-purple-300 border border-purple-500/30",
        COMPLETED: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
        FAILED: "bg-red-500/20 text-red-300 border border-red-500/30",
        RECTIFIED: "bg-orange-500/20 text-orange-300 border border-orange-500/30",
        SETTLED: "bg-slate-600/40 text-slate-300 border border-slate-600/50",
    };

    async function handleMarkComplete() {
        if (isActionPending("markComplete")) return;
        setActionPending("markComplete", true);

        const now = new Date();
        const voucherResponseDeadline = new Date(now.getTime() + VOUCHER_RESPONSE_WINDOW_HOURS * 60 * 60 * 1000);

        await runOptimisticMutation({
            captureSnapshot: () => ({ taskState }),
            applyOptimistic: () => {
                setTaskState((prev) => ({
                    ...prev,
                    status: "AWAITING_VOUCHER",
                    marked_completed_at: now.toISOString(),
                    voucher_response_deadline: voucherResponseDeadline.toISOString(),
                    updated_at: now.toISOString(),
                }));
            },
            runMutation: () => markTaskComplete(taskState.id),
            rollback: (snapshot) => {
                setTaskState(snapshot.taskState);
            },
            onSuccess: () => {
                refreshInBackground();
            },
        });

        setActionPending("markComplete", false);
    }

    async function handlePostpone(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();

        if (isActionPending("postpone")) return;
        if (isOverdue) {
            toast.error("Cannot postpone an overdue task.");
            return;
        }

        const formData = new FormData(e.currentTarget);
        const newDeadlineLocal = formData.get("newDeadline");
        if (typeof newDeadlineLocal !== "string" || !newDeadlineLocal) {
            toast.error("Please choose a valid deadline.");
            return;
        }

        const parsedLocal = fromDateTimeLocalValue(newDeadlineLocal);
        if (!parsedLocal) {
            toast.error("Please choose a valid deadline.");
            return;
        }

        if (parsedLocal < minPostpone || parsedLocal > maxPostpone) {
            toast.error("Postpone must be within 1 minute to 1 hour from the current deadline.");
            return;
        }

        const newDeadlineIso = localDateTimeToIso(newDeadlineLocal);
        if (!newDeadlineIso) {
            toast.error("Please choose a valid deadline.");
            return;
        }

        setActionPending("postpone", true);
        const optimisticUpdatedAt = new Date().toISOString();

        await runOptimisticMutation({
            captureSnapshot: () => ({ taskState, postponeOpen }),
            applyOptimistic: () => {
                setPostponeOpen(false);
                setTaskState((prev) => ({
                    ...prev,
                    status: "POSTPONED",
                    deadline: newDeadlineIso,
                    postponed_at: optimisticUpdatedAt,
                    updated_at: optimisticUpdatedAt,
                }));
            },
            runMutation: () => postponeTask(taskState.id, newDeadlineIso),
            rollback: (snapshot) => {
                setTaskState(snapshot.taskState);
                setPostponeOpen(snapshot.postponeOpen);
            },
            onSuccess: () => {
                refreshInBackground();
            },
        });

        setActionPending("postpone", false);
    }

    async function handleForceMajeure() {
        if (isActionPending("forceMajeure")) return;
        if (!confirm("Are you sure? This uses your 1 monthly Force Majeure pass and will settle the task without failure cost.")) return;

        setActionPending("forceMajeure", true);
        const optimisticUpdatedAt = new Date().toISOString();

        await runOptimisticMutation({
            captureSnapshot: () => ({ taskState }),
            applyOptimistic: () => {
                setTaskState((prev) => ({
                    ...prev,
                    status: "SETTLED",
                    updated_at: optimisticUpdatedAt,
                }));
            },
            runMutation: () => forceMajeureTask(taskState.id),
            rollback: (snapshot) => {
                setTaskState(snapshot.taskState);
            },
            onSuccess: () => {
                refreshInBackground();
            },
        });

        setActionPending("forceMajeure", false);
    }

    async function handleCancelRepetition() {
        if (isRepetitionStopped || isActionPending("cancelRepetition")) return;
        if (!confirm("Are you sure you want to stop future repetitions? This task will remain, but no more will be created.")) return;

        setActionPending("cancelRepetition", true);

        await runOptimisticMutation({
            captureSnapshot: () => ({ taskState, isRepetitionStopped }),
            applyOptimistic: () => {
                setIsRepetitionStopped(true);
                setTaskState((prev) => ({
                    ...prev,
                    recurrence_rule: prev.recurrence_rule
                        ? { ...prev.recurrence_rule, active: false }
                        : prev.recurrence_rule,
                }));
            },
            runMutation: () => cancelRepetition(taskState.id),
            rollback: (snapshot) => {
                setTaskState(snapshot.taskState);
                setIsRepetitionStopped(snapshot.isRepetitionStopped);
            },
            onSuccess: () => {
                refreshInBackground();
            },
        });

        setActionPending("cancelRepetition", false);
    }

    const formatFocusTime = (seconds: number) => {
        if (!seconds || seconds <= 0) return "0m";
        if (seconds < 60) return `${seconds}s`;
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    };

    const formatEventLabel = (event: TaskEvent) => {
        if (event.event_type === "POMO_COMPLETED") {
            const elapsedRaw = event.metadata?.elapsed_seconds;
            const elapsedSeconds =
                typeof elapsedRaw === "number"
                    ? elapsedRaw
                    : Number(elapsedRaw ?? 0);
            return `Focus session completed (${formatFocusTime(elapsedSeconds)})`;
        }
        return event.event_type.replace(/_/g, " ");
    };

    const visibleEvents = useMemo(() => {
        const seenSessionIds = new Set<string>();
        return events.filter((event) => {
            if (event.event_type !== "POMO_COMPLETED") return true;
            const sessionIdRaw = event.metadata?.session_id;
            const sessionId = typeof sessionIdRaw === "string" ? sessionIdRaw : "";
            if (!sessionId) return true;
            if (seenSessionIds.has(sessionId)) return false;
            seenSessionIds.add(sessionId);
            return true;
        });
    }, [events]);

    return (
        <div className="max-w-3xl mx-auto space-y-6 px-4 md:px-0">
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                        {taskState.title}
                        {taskState.recurrence_rule_id && (
                            <Repeat className="h-5 w-5 text-slate-500 shrink-0" />
                        )}
                    </h1>
                    <div className="flex items-center gap-3 mt-2">
                        <Badge className={statusColors[taskState.status]}>
                            {taskState.status === "FAILED"
                                ? (taskState.marked_completed_at ? "DENIED" : "FAILED")
                                : taskState.status === "SETTLED" ? "FORCE MAJEURE" : taskState.status.replace("_", " ")}
                        </Badge>
                        <span className="text-slate-400">
                            Voucher: {taskState.voucher?.username}
                        </span>
                    </div>
                </div>
            </div>

            <Card className="bg-slate-900/40 border-slate-800">
                <CardHeader>
                    <CardTitle className="text-white">Task Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {taskState.description && (
                        <div>
                            <p className="text-sm text-slate-400">Description</p>
                            <p className="text-white">{taskState.description}</p>
                        </div>
                    )}

                    <div className={`grid grid-cols-1 ${hasPomoData ? "sm:grid-cols-3" : "sm:grid-cols-2"} gap-4`}>
                        <div>
                            <p className="text-sm text-slate-400">Deadline</p>
                            <p className={`text-lg font-medium ${isOverdue ? "text-red-400" : "text-white"}`}>
                                {deadline.toLocaleDateString()} {" "}
                                {deadline.toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                })}
                            </p>
                        </div>
                        <div>
                            <p className="text-sm text-slate-400">Failure Cost</p>
                            <p className="text-lg font-medium text-pink-400">
                                {"\u20ac"}{(taskState.failure_cost_cents / 100).toFixed(2)}
                            </p>
                        </div>
                        {hasPomoData && (
                            <div>
                                <p className="text-sm text-slate-400">Time Focused</p>
                                <p className="text-lg font-medium text-cyan-300">
                                    {formatFocusTime(pomoSummary?.totalSeconds || 0)}
                                </p>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    {(pomoSummary?.sessionCount || 0)} sessions
                                </p>
                            </div>
                        )}
                    </div>

                    {taskState.postponed_at && (
                        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                            <p className="text-sm text-amber-300">
                                Postponed once on {new Date(taskState.postponed_at).toLocaleString()}
                            </p>
                        </div>
                    )}

                    {taskState.voucher_response_deadline && (taskState.status === "AWAITING_VOUCHER" || taskState.status === "MARKED_COMPLETED") && (
                        <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30">
                            <p className="text-sm text-purple-300">
                                Voucher must respond by {new Date(taskState.voucher_response_deadline).toLocaleString()}
                            </p>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card className="bg-slate-900/40 border-slate-800">
                <CardHeader>
                    <CardTitle className="text-white">Actions</CardTitle>
                    <CardDescription className="text-slate-400">
                        Available actions for this task
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3">
                    {(taskState.status === "CREATED" || taskState.status === "POSTPONED") && (
                        <>
                            <PomoButton
                                taskId={taskState.id}
                                variant="full"
                                className="mr-1"
                                defaultDurationMinutes={defaultPomoDurationMinutes}
                            />
                            <Button
                                onClick={handleMarkComplete}
                                disabled={isActionPending("markComplete") || isOverdue}
                                className="bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300"
                            >
                                Mark Complete
                            </Button>

                            {taskState.status === "CREATED" && !taskState.postponed_at && !isOverdue && (
                                <Dialog open={postponeOpen} onOpenChange={handlePostponeOpenChange}>
                                    <DialogTrigger asChild>
                                        <Button
                                            variant="outline"
                                            className="bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300"
                                        >
                                            Postpone (1x only)
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent className="bg-slate-900 border-slate-800">
                                        <DialogHeader>
                                            <DialogTitle className="text-white">
                                                Postpone Task
                                            </DialogTitle>
                                            <DialogDescription className="text-slate-400">
                                                You can postpone once by up to 1 hour.
                                            </DialogDescription>
                                        </DialogHeader>
                                        <form onSubmit={handlePostpone} className="space-y-4">
                                            <div className="space-y-2">
                                                <Label className="text-slate-200">New Deadline</Label>
                                                {isIOSDevice ? (
                                                    <div className="space-y-2">
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                            <Input
                                                                id="postponeDate"
                                                                type="date"
                                                                value={postponeDate}
                                                                onChange={(e) => handlePostponeDateChange(e.target.value)}
                                                                className="bg-slate-700/50 border-slate-600 text-white"
                                                                required
                                                            />
                                                            <Input
                                                                id="postponeTime"
                                                                type="time"
                                                                value={postponeTime}
                                                                onChange={(e) => handlePostponeTimeChange(e.target.value)}
                                                                step={60}
                                                                className="bg-slate-700/50 border-slate-600 text-white"
                                                                required
                                                            />
                                                        </div>
                                                        <input name="newDeadline" type="hidden" value={postponeValue} readOnly />
                                                    </div>
                                                ) : (
                                                    <Input
                                                        name="newDeadline"
                                                        type="datetime-local"
                                                        min={minPostponeLocal}
                                                        max={maxPostponeLocal}
                                                        value={postponeValue}
                                                        onChange={(e) => setPostponeValue(e.target.value)}
                                                        className="bg-slate-700/50 border-slate-600 text-white"
                                                        required
                                                    />
                                                )}
                                            </div>
                                            <DialogFooter>
                                                <Button
                                                    type="submit"
                                                    disabled={isActionPending("postpone")}
                                                    className="bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300"
                                                >
                                                    Confirm Postpone
                                                </Button>
                                            </DialogFooter>
                                        </form>
                                    </DialogContent>
                                </Dialog>
                            )}
                        </>
                    )}

                    {taskState.status === "FAILED" && (
                        <Button
                            variant="ghost"
                            onClick={handleForceMajeure}
                            disabled={isActionPending("forceMajeure")}
                            className="bg-slate-800/40 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700/40"
                        >
                            Use Force Majeure
                        </Button>
                    )}

                    {taskState.recurrence_rule_id && (
                        <Button
                            variant="destructive"
                            onClick={handleCancelRepetition}
                            disabled={isActionPending("cancelRepetition") || isRepetitionStopped}
                            className={isRepetitionStopped
                                ? "bg-slate-800/50 text-slate-500 border border-slate-700/60 cursor-not-allowed"
                                : "bg-red-950/30 text-red-400 border border-red-900/50 hover:bg-red-900/40"}
                        >
                            <Repeat className="mr-2 h-4 w-4" />
                            {isRepetitionStopped ? "Repetition Stopped" : "Stop Future Repetitions"}
                        </Button>
                    )}

                    {taskState.status === "AWAITING_VOUCHER" && (
                        <p className="text-slate-400">
                            Waiting for voucher response...
                        </p>
                    )}

                    {taskState.status === "COMPLETED" && (
                        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 w-full">
                            <p className="text-green-300">Task completed successfully.</p>
                        </div>
                    )}

                    {taskState.status === "FAILED" && (
                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 w-full">
                            <p className="text-red-300">
                                {taskState.marked_completed_at
                                    ? "Denied by voucher."
                                    : "Deadline missed. Failure cost:"} {"\u20ac"}{(taskState.failure_cost_cents / 100).toFixed(2)} added to ledger.
                            </p>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card className="bg-slate-900/40 border-slate-800">
                <CardHeader>
                    <CardTitle className="text-white">Activity Log</CardTitle>
                </CardHeader>
                <CardContent>
                    {visibleEvents.length === 0 ? (
                        <p className="text-slate-400">No activity yet</p>
                    ) : (
                        <div className="space-y-3">
                            {visibleEvents.map((event) => (
                                <div key={event.id} className="flex items-start gap-3">
                                    <div className="h-2 w-2 rounded-full bg-purple-500 mt-2" />
                                    <div>
                                        <p className="text-white text-sm">
                                            {formatEventLabel(event)}
                                        </p>
                                        <p className="text-xs text-slate-500">
                                            {new Date(event.created_at).toLocaleString()}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
