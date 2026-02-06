"use client";

import { useState } from "react";
import { voucherAccept, voucherDeny, authorizeRectify } from "@/actions/voucher";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { TaskWithRelations } from "@/lib/types";
import { Timer } from "lucide-react";

interface VoucherDashboardClientProps {
    pendingTasks: TaskWithRelations[];
    failedTasks: (TaskWithRelations & { rectify_passes_used?: number })[];
    assignedTasks: TaskWithRelations[];
    historyTasks: (TaskWithRelations & { rectify_passes_used?: number })[];
}

export default function VoucherDashboardClient({
    pendingTasks,
    historyTasks,
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

    return (
        <div className="max-w-3xl mx-auto space-y-12 pb-20 mt-12 px-4 md:px-0">
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

            {/* Pending Section */}
            <section className="space-y-4">
                <h2 className="text-xl font-semibold text-slate-500 border-b border-slate-900 pb-2">
                    Pending
                </h2>
                {pendingTasks.length === 0 ? (
                    <div className="bg-slate-900/40 border border-slate-800/20 rounded-xl py-12 text-center">
                        <p className="text-slate-500 text-sm">No pending vouch requests</p>
                    </div>
                ) : (
                    <div className="flex flex-col">
                        {pendingTasks.map((task) => (
                            <CompactPendingItem
                                key={task.id}
                                task={task}
                                onAccept={() => handleAccept(task.id)}
                                onDeny={() => handleDeny(task.id)}
                                isLoading={loadingId === task.id}
                            />
                        ))}
                    </div>
                )}
            </section>

            {/* Vouched Section */}
            <section className="space-y-4">
                <h2 className="text-xl font-semibold text-slate-500 border-b border-slate-900 pb-2">
                    Vouched
                </h2>
                {historyTasks.length === 0 ? (
                    <div className="py-8 text-center">
                        <p className="text-slate-600 text-sm">No history yet</p>
                    </div>
                ) : (
                    <div className="flex flex-col border-t border-slate-900/50">
                        {historyTasks.map((task) => (
                            <CompactHistoryItem
                                key={task.id}
                                task={task}
                                onRectify={() => handleRectify(task.id)}
                                isLoading={loadingId === task.id}
                            />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}

function CompactPendingItem({
    task,
    onAccept,
    onDeny,
    isLoading,
}: {
    task: TaskWithRelations;
    onAccept: () => void;
    onDeny: () => void;
    isLoading: boolean;
}) {
    const formatPomoBadge = (seconds: number) => {
        if (seconds < 60) return "<1m";
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    };

    const deadline = new Date(task.voucher_response_deadline || "");
    const hoursLeft = Math.max(
        0,
        Math.floor((deadline.getTime() - Date.now()) / (1000 * 60 * 60))
    );
    const pomoTotalSeconds = task.pomo_total_seconds || 0;

    return (
        <div className="group flex items-center gap-3 py-6 border-b border-slate-900 last:border-0 hover:bg-slate-900/10 -mx-4 px-4 transition-colors">
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <p className="text-lg font-medium text-slate-100 truncate">{task.title}</p>
                    <Badge variant="outline" className={hoursLeft < 6 ? "bg-red-500/10 text-red-500 border-red-500/30 text-[10px]" : "bg-purple-500/10 text-purple-400 border-purple-500/30 text-[10px]"}>
                        {hoursLeft}h left
                    </Badge>
                    {pomoTotalSeconds > 0 && (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30 text-[10px]">
                            <Timer className="h-3 w-3 mr-1" />
                            {formatPomoBadge(pomoTotalSeconds)}
                        </Badge>
                    )}
                </div>
                <p className="text-sm text-slate-500 mt-1">
                    Requested by <span className="text-slate-300">{task.user?.username}</span> • Stake: <span className="text-slate-400 font-mono">€{(task.failure_cost_cents / 100).toFixed(2)}</span>
                </p>
            </div>

            <div className="flex items-center gap-3">
                <Button
                    size="sm"
                    onClick={onAccept}
                    disabled={isLoading}
                    className="h-9 px-6 bg-slate-100 text-slate-950 hover:bg-white transition-all font-semibold"
                >
                    {isLoading ? "..." : "Accept"}
                </Button>
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={onDeny}
                    disabled={isLoading}
                    className="h-9 text-slate-500 hover:text-red-400 hover:bg-red-500/10"
                >
                    {isLoading ? "..." : "Deny"}
                </Button>
            </div>
        </div>
    );
}

function CompactHistoryItem({
    task,
    onRectify,
    isLoading,
}: {
    task: TaskWithRelations & { rectify_passes_used?: number };
    onRectify: () => void;
    isLoading: boolean;
}) {
    const statusColors: Record<string, string> = {
        COMPLETED: "text-lime-300",        // Bright neon green (accepted)
        FAILED: "text-[#dc322f]",          // Red
        RECTIFIED: "text-[#cb4b16]",       // Orange
        SETTLED: "text-[#2aa198]",         // Cyan
        DELETED: "text-slate-500",         // Grey
    };

    const isRectifiable = task.status === "FAILED";
    const passLimitReached = (task.rectify_passes_used ?? 0) >= 5;

    return (
        <div className="group flex items-center gap-3 py-4 border-b border-slate-900/50 last:border-0 hover:bg-slate-900/10 -mx-4 px-4 transition-colors">
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <p className="text-base font-medium text-slate-300 truncate">{task.title}</p>
                    <Badge variant="outline" className={`text-[10px] h-4 py-0 px-1 border-slate-800 ${statusColors[task.status] || "text-slate-400"}`}>
                        {task.status === "FAILED"
                            ? (task.marked_completed_at ? "DENIED" : "FAILED")
                            : task.status === "COMPLETED"
                                ? "ACCEPTED"
                                : task.status}
                    </Badge>
                </div>
                <p className="text-xs text-slate-600 mt-1">
                    {task.user?.username} • {new Date(task.updated_at).toLocaleDateString()}
                </p>
            </div>

            <div className="flex items-center gap-3">
                {isRectifiable && (
                    <div className="flex flex-col items-end">
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={onRectify}
                            disabled={isLoading || passLimitReached}
                            className="h-8 text-xs bg-orange-500/5 text-orange-400 hover:bg-orange-500/10 hover:text-orange-300 border border-orange-500/10"
                        >
                            {isLoading ? "..." : passLimitReached ? "Limit" : "🔄 Rectify"}
                        </Button>
                        <span className={`text-[9px] mt-1 font-mono ${passLimitReached ? "text-red-600" : "text-slate-700"}`}>
                            {task.rectify_passes_used ?? 0}/5 used
                        </span>
                    </div>
                )}
                {!isRectifiable && (
                    <span className="text-xs text-slate-700 font-mono">
                        €{(task.failure_cost_cents / 100).toFixed(2)}
                    </span>
                )}
            </div>
        </div>
    );
}
