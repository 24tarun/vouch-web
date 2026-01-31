"use client";

import { useState } from "react";
import { voucherAccept, voucherDeny, authorizeRectify, voucherDeleteTask } from "@/actions/voucher";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TaskWithRelations } from "@/lib/types";

interface VoucherDashboardClientProps {
    pendingTasks: TaskWithRelations[];
    failedTasks: TaskWithRelations[];
    assignedTasks: TaskWithRelations[];
}

export default function VoucherDashboardClient({
    pendingTasks,
    failedTasks,
    assignedTasks,
}: VoucherDashboardClientProps) {
    const router = useRouter();
    const [loadingId, setLoadingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function handleAccept(taskId: string) {
        setLoadingId(taskId);
        setError(null);
        const result = await voucherAccept(taskId);
        if (result.error) {
            setError(result.error);
        }
        setLoadingId(null);
        router.refresh();
    }

    async function handleDeny(taskId: string) {
        setLoadingId(taskId);
        setError(null);
        const result = await voucherDeny(taskId);
        if (result.error) {
            setError(result.error);
        }
        setLoadingId(null);
        router.refresh();
    }

    async function handleRectify(taskId: string) {
        setLoadingId(taskId);
        setError(null);
        const result = await authorizeRectify(taskId);
        if (result.error) {
            setError(result.error);
        }
        setLoadingId(null);
        router.refresh();
    }

    async function handleDelete(taskId: string) {
        setLoadingId(taskId);
        setError(null);
        const result = await voucherDeleteTask(taskId);
        if (result.error) {
            setError(result.error);
        }
        setLoadingId(null);
        router.refresh();
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-white">Vouch Requests</h1>
                <p className="text-slate-400 mt-1">
                    Review and verify task completions for your friends
                </p>
            </div>

            {error && (
                <div className="p-3 rounded-lg bg-red-500/20 text-red-300 border border-red-500/30 text-sm">
                    {error}
                </div>
            )}

            <Tabs defaultValue="pending" className="w-full">
                <TabsList className="bg-slate-800/50 border border-slate-700">
                    <TabsTrigger
                        value="pending"
                        className="data-[state=active]:bg-purple-600"
                    >
                        Pending ({pendingTasks.length})
                    </TabsTrigger>
                    <TabsTrigger
                        value="failed"
                        className="data-[state=active]:bg-purple-600"
                    >
                        Can Rectify ({failedTasks.length})
                    </TabsTrigger>
                    <TabsTrigger
                        value="assigned"
                        className="data-[state=active]:bg-purple-600"
                    >
                        Assigned ({assignedTasks.length})
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="pending" className="mt-4">
                    {pendingTasks.length === 0 ? (
                        <Card className="bg-slate-800/50 border-slate-700">
                            <CardContent className="py-12 text-center">
                                <p className="text-slate-400">No pending vouch requests</p>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="space-y-4">
                            {pendingTasks.map((task) => (
                                <VouchRequestCard
                                    key={task.id}
                                    task={task}
                                    onAccept={() => handleAccept(task.id)}
                                    onDeny={() => handleDeny(task.id)}
                                    onDelete={() => handleDelete(task.id)}
                                    isLoading={loadingId === task.id}
                                />
                            ))}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="failed" className="mt-4">
                    {failedTasks.length === 0 ? (
                        <Card className="bg-slate-800/50 border-slate-700">
                            <CardContent className="py-12 text-center">
                                <p className="text-slate-400">No failed tasks to rectify</p>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="space-y-4">
                            {failedTasks.map((task) => (
                                <RectifyCard
                                    key={task.id}
                                    task={task}
                                    onRectify={() => handleRectify(task.id)}
                                    isLoading={loadingId === task.id}
                                />
                            ))}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="assigned" className="mt-4">
                    {assignedTasks.length === 0 ? (
                        <Card className="bg-slate-800/50 border-slate-700">
                            <CardContent className="py-12 text-center">
                                <p className="text-slate-400">No assigned tasks</p>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="space-y-4">
                            {assignedTasks.map((task) => (
                                <AssignedCard
                                    key={task.id}
                                    task={task}
                                    onDelete={() => handleDelete(task.id)}
                                    isLoading={loadingId === task.id}
                                />
                            ))}
                        </div>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}

function VouchRequestCard({
    task,
    onAccept,
    onDeny,
    onDelete,
    isLoading,
}: {
    task: TaskWithRelations;
    onAccept: () => void;
    onDeny: () => void;
    onDelete: () => void;
    isLoading: boolean;
}) {
    const deadline = new Date(task.voucher_response_deadline || "");
    const hoursLeft = Math.max(
        0,
        Math.floor((deadline.getTime() - Date.now()) / (1000 * 60 * 60))
    );

    return (
        <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
                <div className="flex items-start justify-between">
                    <div>
                        <CardTitle className="text-white">{task.title}</CardTitle>
                        <CardDescription className="text-slate-400">
                            From: {task.user?.username}
                        </CardDescription>
                    </div>
                    <Badge
                        className={`${hoursLeft < 6 ? "bg-red-500" : "bg-purple-500"
                            } text-white`}
                    >
                        {hoursLeft}h left
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {task.description && (
                    <p className="text-slate-300">{task.description}</p>
                )}

                <div className="flex items-center gap-4 text-sm text-slate-400">
                    <span>
                        Deadline: {new Date(task.deadline).toLocaleDateString()}
                    </span>
                    <span>Stake: €{(task.failure_cost_cents / 100).toFixed(2)}</span>
                </div>

                <div className="flex gap-3">
                    <Button
                        onClick={onAccept}
                        disabled={isLoading}
                        className="flex-1 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
                    >
                        {isLoading ? "..." : "✅ Accept"}
                    </Button>
                    <Button
                        onClick={onDeny}
                        disabled={isLoading}
                        variant="outline"
                        className="flex-1 border-red-500/50 text-red-300 hover:bg-red-500/10"
                    >
                        {isLoading ? "..." : "❌ Deny"}
                    </Button>
                    <Button
                        onClick={onDelete}
                        disabled={isLoading}
                        variant="ghost"
                        className="flex-1 text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                    >
                        {isLoading ? "..." : "🗑️ Delete"}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

function AssignedCard({
    task,
    onDelete,
    isLoading,
}: {
    task: TaskWithRelations;
    onDelete: () => void;
    isLoading: boolean;
}) {
    return (
        <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
                <div className="flex items-start justify-between">
                    <div>
                        <CardTitle className="text-white">{task.title}</CardTitle>
                        <CardDescription className="text-slate-400">
                            Owner: {task.user?.username}
                        </CardDescription>
                    </div>
                    <Badge className="bg-slate-600 text-white">{task.status}</Badge>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {task.description && <p className="text-slate-300">{task.description}</p>}
                <div className="flex items-center gap-4 text-sm text-slate-400">
                    <span>Deadline: {new Date(task.deadline).toLocaleString()}</span>
                    <span>Stake: €{(task.failure_cost_cents / 100).toFixed(2)}</span>
                </div>
                <div className="flex gap-3">
                    <Button
                        onClick={onDelete}
                        disabled={isLoading}
                        variant="outline"
                        className="flex-1 border-red-500/50 text-red-300 hover:bg-red-500/10"
                    >
                        {isLoading ? "Deleting..." : "🗑️ Delete Task"}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

function RectifyCard({
    task,
    onRectify,
    isLoading,
}: {
    task: TaskWithRelations;
    onRectify: () => void;
    isLoading: boolean;
}) {
    return (
        <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
                <CardTitle className="text-white">{task.title}</CardTitle>
                <CardDescription className="text-slate-400">
                    Failed task from: {task.user?.username}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                    <p className="text-sm text-red-300">
                        This task failed. Cost: €{(task.failure_cost_cents / 100).toFixed(2)}
                    </p>
                </div>

                <Button
                    onClick={onRectify}
                    disabled={isLoading}
                    className="w-full bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700"
                >
                    {isLoading ? "..." : "🔄 Authorize Rectify Pass"}
                </Button>

                <p className="text-xs text-slate-500 text-center">
                    Uses 1 of their 5 monthly rectify passes
                </p>
            </CardContent>
        </Card>
    );
}
