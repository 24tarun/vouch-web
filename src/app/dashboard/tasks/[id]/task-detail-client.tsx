"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { markTaskComplete, postponeTask, forceMajeureTask, cancelRepetition } from "@/actions/tasks";
import { Button } from "@/components/ui/button";
import { Repeat } from "lucide-react";

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

export default function TaskDetailClient({
    task,
    events,
    pomoSummary,
    defaultPomoDurationMinutes,
}: TaskDetailClientProps) {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [postponeOpen, setPostponeOpen] = useState(false);
    const [isRepetitionStopped, setIsRepetitionStopped] = useState(task.recurrence_rule?.active === false);

    const deadline = new Date(task.deadline);
    const isOverdue =
        deadline < new Date() &&
        !["COMPLETED", "FAILED", "RECTIFIED", "SETTLED"].includes(task.status);

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
        setIsLoading(true);
        setError(null);
        const result = await markTaskComplete(task.id);
        if (result.error) {
            setError(result.error);
        }
        setIsLoading(false);
        router.refresh();
    }

    async function handlePostpone(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (isOverdue) {
            setError("Cannot postpone an overdue task.");
            return;
        }
        setIsLoading(true);
        setError(null);
        const formData = new FormData(e.currentTarget);
        const newDeadline = formData.get("newDeadline") as string;
        const result = await postponeTask(task.id, newDeadline);
        if (result.error) {
            setError(result.error);
        }
        setIsLoading(false);
        setPostponeOpen(false);
        router.refresh();
    }

    async function handleForceMajeure() {
        if (!confirm("Are you sure? This uses your 1 monthly Force Majeure pass and will settle the task without failure cost.")) return;
        setIsLoading(true);
        setError(null);
        const result = await forceMajeureTask(task.id);
        if (result.error) {
            setError(result.error);
        }
        setIsLoading(false);
        router.refresh();
    }

    async function handleCancelRepetition() {
        if (isRepetitionStopped) return;
        if (!confirm("Are you sure you want to stop future repetitions? This task will remain, but no more will be created.")) return;
        setIsLoading(true);
        setError(null);
        const result = await cancelRepetition(task.id);
        if (result.error) {
            setError(result.error);
        } else {
            setIsRepetitionStopped(true);
        }
        setIsLoading(false);
        router.refresh();
    }

    // Calculate max postpone time (1 hour from current deadline)
    const maxPostpone = new Date(deadline.getTime() + 60 * 60 * 1000);
    const minPostpone = new Date(deadline.getTime() + 60 * 1000);
    const hasPomoData = (pomoSummary?.sessionCount || 0) > 0;

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
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                        {task.title}
                        {task.recurrence_rule_id && (
                            <Repeat className="h-5 w-5 text-slate-500 shrink-0" />
                        )}
                    </h1>
                    <div className="flex items-center gap-3 mt-2">
                        <Badge className={statusColors[task.status]}>
                            {task.status === "FAILED"
                                ? (task.marked_completed_at ? "DENIED" : "FAILED")
                                : task.status === "SETTLED" ? "FORCE MAJEURE" : task.status.replace("_", " ")}
                        </Badge>
                        <span className="text-slate-400">
                            Voucher: {task.voucher?.username}
                        </span>
                    </div>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="p-3 rounded-lg bg-red-500/20 text-red-300 border border-red-500/30 text-sm">
                    {error}
                </div>
            )}

            {/* Task Details */}
            <Card className="bg-slate-900/40 border-slate-800">
                <CardHeader>
                    <CardTitle className="text-white">Task Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {task.description && (
                        <div>
                            <p className="text-sm text-slate-400">Description</p>
                            <p className="text-white">{task.description}</p>
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
                                {"\u20ac"}{(task.failure_cost_cents / 100).toFixed(2)}
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

                    {task.postponed_at && (
                        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                            <p className="text-sm text-amber-300">
                                Postponed once on {new Date(task.postponed_at).toLocaleString()}
                            </p>
                        </div>
                    )}

                    {task.voucher_response_deadline && (task.status === "AWAITING_VOUCHER" || task.status === "MARKED_COMPLETED") && (
                        <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30">
                            <p className="text-sm text-purple-300">
                                Voucher must respond by {new Date(task.voucher_response_deadline).toLocaleString()}
                            </p>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Actions */}
            <Card className="bg-slate-900/40 border-slate-800">
                <CardHeader>
                    <CardTitle className="text-white">Actions</CardTitle>
                    <CardDescription className="text-slate-400">
                        Available actions for this task
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3">
                    {(task.status === "CREATED" || task.status === "POSTPONED") && (
                        <>
                            <PomoButton
                                taskId={task.id}
                                variant="full"
                                className="mr-1"
                                defaultDurationMinutes={defaultPomoDurationMinutes}
                            />
                            <Button
                                onClick={handleMarkComplete}
                                disabled={isLoading || isOverdue}
                                className="bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300"
                            >
                                {isLoading ? "Marking..." : "Mark Complete"}
                            </Button>

                            {task.status === "CREATED" && !task.postponed_at && !isOverdue && (
                                <Dialog open={postponeOpen} onOpenChange={setPostponeOpen}>
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
                                                <Input
                                                    name="newDeadline"
                                                    type="datetime-local"
                                                    min={minPostpone.toISOString().slice(0, 16)}
                                                    max={maxPostpone.toISOString().slice(0, 16)}
                                                    defaultValue={maxPostpone.toISOString().slice(0, 16)}
                                                    className="bg-slate-700/50 border-slate-600 text-white"
                                                />
                                            </div>
                                            <DialogFooter>
                                                <Button
                                                    type="submit"
                                                    disabled={isLoading}
                                                    className="bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300"
                                                >
                                                    {isLoading ? "Postponing..." : "Confirm Postpone"}
                                                </Button>
                                            </DialogFooter>
                                        </form>
                                    </DialogContent>
                                </Dialog>
                            )}
                        </>
                    )}

                    {task.status === "FAILED" && (
                        <Button
                            variant="ghost"
                            onClick={handleForceMajeure}
                            disabled={isLoading}
                            className="bg-slate-800/40 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700/40"
                        >
                            {isLoading ? "..." : "Use Force Majeure"}
                        </Button>
                    )}

                    {task.recurrence_rule_id && (
                        <Button
                            variant="destructive"
                            onClick={handleCancelRepetition}
                            disabled={isLoading || isRepetitionStopped}
                            className={isRepetitionStopped
                                ? "bg-slate-800/50 text-slate-500 border border-slate-700/60 cursor-not-allowed"
                                : "bg-red-950/30 text-red-400 border border-red-900/50 hover:bg-red-900/40"}
                        >
                            <Repeat className="mr-2 h-4 w-4" />
                            {isRepetitionStopped ? "Repetition Stopped" : isLoading ? "Stopping..." : "Stop Future Repetitions"}
                        </Button>
                    )}

                    {task.status === "AWAITING_VOUCHER" && (
                        <p className="text-slate-400">
                            Waiting for voucher response...
                        </p>
                    )}

                    {task.status === "COMPLETED" && (
                        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 w-full">
                            <p className="text-green-300">Task completed successfully.</p>
                        </div>
                    )}

                    {task.status === "FAILED" && (
                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 w-full">
                            <p className="text-red-300">
                                {task.marked_completed_at
                                    ? "Denied by voucher."
                                    : "Deadline missed. Failure cost:"} {"\u20ac"}{(task.failure_cost_cents / 100).toFixed(2)} added to ledger.
                            </p>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Event Log */}
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
