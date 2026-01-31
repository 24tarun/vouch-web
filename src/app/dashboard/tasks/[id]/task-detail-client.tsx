"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { markTaskComplete, postponeTask } from "@/actions/tasks";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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

interface TaskDetailClientProps {
    task: TaskWithRelations;
    events: TaskEvent[];
}

export default function TaskDetailClient({
    task,
    events,
}: TaskDetailClientProps) {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [postponeOpen, setPostponeOpen] = useState(false);

    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const deadline = new Date(task.deadline);
    const isOverdue =
        deadline < new Date() &&
        !["COMPLETED", "FAILED", "RECTIFIED", "SETTLED"].includes(task.status);

    if (!mounted) {
        return <div className="p-10 text-center text-slate-500">Loading task details...</div>;
    }

    const statusColors: Record<string, string> = {
        CREATED: "bg-blue-500",
        POSTPONED: "bg-yellow-500",
        MARKED_COMPLETED: "bg-purple-500",
        AWAITING_VOUCHER: "bg-purple-500",
        COMPLETED: "bg-green-500",
        FAILED: "bg-red-500",
        RECTIFIED: "bg-orange-500",
        SETTLED: "bg-slate-600",
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

    // Calculate max postpone time (1 hour from current deadline)
    const maxPostpone = new Date(deadline.getTime() + 60 * 60 * 1000);
    const minPostpone = new Date(deadline.getTime() + 60 * 1000);

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-white">{task.title}</h1>
                    <div className="flex items-center gap-3 mt-2">
                        <Badge className={`${statusColors[task.status]} text-white`}>
                            {task.status.replace("_", " ")}
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
            <Card className="bg-slate-800/50 border-slate-700">
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

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <p className="text-sm text-slate-400">Deadline</p>
                            <p className={`text-lg font-medium ${isOverdue ? "text-red-400" : "text-white"}`}>
                                {deadline.toLocaleDateString()}{" "}
                                {deadline.toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                })}
                            </p>
                        </div>
                        <div>
                            <p className="text-sm text-slate-400">Failure Cost</p>
                            <p className="text-lg font-medium text-pink-400">
                                €{(task.failure_cost_cents / 100).toFixed(2)}
                            </p>
                        </div>
                    </div>

                    {task.postponed_at && (
                        <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                            <p className="text-sm text-yellow-300">
                                ⚠️ Postponed once on{" "}
                                {new Date(task.postponed_at).toLocaleString()}
                            </p>
                        </div>
                    )}

                    {task.voucher_response_deadline && (
                        <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30">
                            <p className="text-sm text-purple-300">
                                🕐 Voucher must respond by{" "}
                                {new Date(task.voucher_response_deadline).toLocaleString()}
                            </p>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Actions */}
            <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                    <CardTitle className="text-white">Actions</CardTitle>
                    <CardDescription className="text-slate-400">
                        Available actions for this task
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3">
                    {(task.status === "CREATED" || task.status === "POSTPONED") && (
                        <>
                            <Button
                                onClick={handleMarkComplete}
                                disabled={isLoading || isOverdue}
                                className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
                            >
                                {isLoading ? "Marking..." : "✅ Mark Complete"}
                            </Button>

                            {task.status === "CREATED" && !task.postponed_at && !isOverdue && (
                                <Dialog open={postponeOpen} onOpenChange={setPostponeOpen}>
                                    <DialogTrigger asChild>
                                        <Button
                                            variant="outline"
                                            className="border-yellow-500/50 text-yellow-300 hover:bg-yellow-500/10"
                                        >
                                            ⏰ Postpone (1x only)
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent className="bg-slate-800 border-slate-700">
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
                                                    className="bg-yellow-600 hover:bg-yellow-700"
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

                    {task.status === "AWAITING_VOUCHER" && (
                        <p className="text-slate-400">
                            Waiting for voucher response...
                        </p>
                    )}

                    {task.status === "COMPLETED" && (
                        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 w-full">
                            <p className="text-green-300">🎉 Task completed successfully!</p>
                        </div>
                    )}

                    {task.status === "FAILED" && (
                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 w-full">
                            <p className="text-red-300">
                                ❌ Task failed. €{(task.failure_cost_cents / 100).toFixed(2)} added to ledger.
                            </p>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Event Log */}
            <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                    <CardTitle className="text-white">Activity Log</CardTitle>
                </CardHeader>
                <CardContent>
                    {events.length === 0 ? (
                        <p className="text-slate-400">No activity yet</p>
                    ) : (
                        <div className="space-y-3">
                            {events.map((event) => (
                                <div key={event.id} className="flex items-start gap-3">
                                    <div className="h-2 w-2 rounded-full bg-purple-500 mt-2" />
                                    <div>
                                        <p className="text-white text-sm">
                                            {event.event_type.replace("_", " ")}
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
