"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import type { Task } from "@/lib/types";
import { AlertTriangle, Check, Timer, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { canOwnerTemporarilyDelete } from "@/lib/task-delete-window";

type StatsTask = Task & { pomo_total_seconds?: number };

interface CompactStatsItemProps {
    task: StatsTask;
    showQuickActions?: boolean;
    onComplete?: (task: StatsTask) => void;
    onPostpone?: (task: StatsTask) => void;
    onQuickPomo?: (task: StatsTask) => void;
    onDelete?: (task: StatsTask) => void;
    isCompleting?: boolean;
    isPostponing?: boolean;
    isDeleting?: boolean;
    isStartingPomo?: boolean;
    defaultPomoDurationMinutes?: number;
}

export function CompactStatsItem({
    task,
    showQuickActions = false,
    onComplete,
    onPostpone,
    onQuickPomo,
    onDelete,
    isCompleting = false,
    isPostponing = false,
    isDeleting = false,
    isStartingPomo = false,
    defaultPomoDurationMinutes = 25,
}: CompactStatsItemProps) {
    const router = useRouter();
    const [nowMs, setNowMs] = useState(() => Date.now());
    const detailPath = `/dashboard/tasks/${task.id}`;

    useEffect(() => {
        if (!showQuickActions) return;

        const id = window.setInterval(() => {
            setNowMs(Date.now());
        }, 15000);

        return () => {
            window.clearInterval(id);
        };
    }, [showQuickActions]);

    const statusColors: Record<string, string> = {
        CREATED: "text-blue-400",
        POSTPONED: "text-amber-400",
        MARKED_COMPLETED: "text-yellow-400",
        AWAITING_VOUCHER: "text-yellow-400",
        COMPLETED: "text-lime-300",
        FAILED: "text-red-500",
        RECTIFIED: "text-orange-500",
        SETTLED: "text-cyan-400",
        DELETED: "text-slate-500",
    };

    const statusLabels: Record<string, string> = {
        CREATED: "ACTIVE",
        POSTPONED: "POSTPONED",
        MARKED_COMPLETED: "AWAITING VOUCHER",
        AWAITING_VOUCHER: "AWAITING VOUCHER",
        COMPLETED: "ACCEPTED",
        FAILED: "FAILED",
        RECTIFIED: "RECTIFIED",
        SETTLED: "FORCE MAJEURE",
        DELETED: "DELETED",
    };

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        const day = d.getDate().toString().padStart(2, "0");
        const month = (d.getMonth() + 1).toString().padStart(2, "0");
        const year = d.getFullYear();
        const hours = d.getHours().toString().padStart(2, "0");
        const minutes = d.getMinutes().toString().padStart(2, "0");
        return `${day}/${month}/${year} at ${hours}:${minutes}`;
    };

    const formatPomoBadge = (seconds: number) => {
        if (seconds < 60) return "<1m";
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    };

    const pomoTotalSeconds = task.pomo_total_seconds || 0;
    const statusColorClass = statusColors[task.status] || "text-slate-500";
    const isActiveTask = task.status === "CREATED" || task.status === "POSTPONED";
    const isOverdue = new Date(task.deadline) < new Date();
    const canComplete = isActiveTask && !isOverdue;
    const canPostpone = task.status === "CREATED" && !task.postponed_at && !isOverdue;
    const canQuickPomo = isActiveTask;
    const canDelete = !task.id.startsWith("temp-") && canOwnerTemporarilyDelete(task, nowMs);
    const canShowActions = showQuickActions && isActiveTask;

    return (
        <div
            id={`task-${task.id}`}
            className="group flex items-center gap-3 py-6 border-b border-slate-900 last:border-0 -mx-4 px-4 transition-colors hover:bg-slate-900/10 relative scroll-mt-24"
            onClick={(event) => {
                const target = event.target as HTMLElement;
                if (target.closest("button,a,input,select,textarea")) return;
                router.push(detailPath);
            }}
            onMouseEnter={() => {
                void router.prefetch(detailPath);
            }}
        >
            <div className="flex-1 min-w-0 z-10">
                <div className="flex items-center gap-2">
                    <p className="text-lg font-medium text-white group-hover:text-blue-400 transition-colors truncate">
                        {task.title}
                    </p>
                    {!isActiveTask && (
                        <Badge variant="outline" className={`text-[9px] h-4 py-0 px-1 border-slate-900 uppercase tracking-tighter ${statusColorClass}`}>
                            {task.status === "FAILED"
                                ? (task.marked_completed_at ? "DENIED" : "FAILED")
                                : (statusLabels[task.status] || task.status)}
                        </Badge>
                    )}
                    {!isActiveTask && pomoTotalSeconds > 0 && (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30 text-[10px]">
                            <Timer className="h-3 w-3 mr-1" />
                            {formatPomoBadge(pomoTotalSeconds)}
                        </Badge>
                    )}
                </div>
                <p className="text-xs text-slate-400 mt-1" suppressHydrationWarning>
                    {["CREATED", "POSTPONED"].includes(task.status)
                        ? `Deadline on ${formatDate(task.deadline)}`
                        : `Updated on ${formatDate(task.updated_at)}`}
                </p>
            </div>

            {canShowActions && (
                <div className="relative z-20 flex items-center gap-2">
                    <button
                        type="button"
                        disabled={isCompleting || !canComplete}
                        onClick={() => onComplete?.(task)}
                        className={cn(
                            "h-8 w-8 rounded-md border flex items-center justify-center transition-colors",
                            canComplete
                                ? "bg-emerald-600/20 hover:bg-emerald-600/30 border-emerald-500/40 text-emerald-300"
                                : "bg-slate-800/50 border-slate-700/60 text-slate-500 cursor-not-allowed"
                        )}
                        aria-label="Mark complete"
                        title="Mark complete"
                    >
                        <Check className="h-4 w-4" strokeWidth={3} />
                    </button>

                    <button
                        type="button"
                        disabled={isPostponing || !canPostpone}
                        onClick={() => onPostpone?.(task)}
                        className={cn(
                            "h-8 w-8 rounded-md border flex items-center justify-center transition-colors",
                            canPostpone
                                ? "bg-amber-600/20 hover:bg-amber-600/30 border-amber-500/40 text-amber-300"
                                : "bg-slate-800/50 border-slate-700/60 text-slate-500 cursor-not-allowed"
                        )}
                        aria-label="Postpone one hour"
                        title={canPostpone ? "Postpone by 1 hour" : "Already postponed or overdue"}
                    >
                        <AlertTriangle className="h-4 w-4" />
                    </button>

                    <button
                        type="button"
                        disabled={isStartingPomo || !canQuickPomo}
                        onClick={() => onQuickPomo?.(task)}
                        className={cn(
                            "h-8 w-8 rounded-md border flex items-center justify-center transition-colors transition-shadow",
                            canQuickPomo
                                ? "bg-cyan-600/20 hover:bg-cyan-600/30 border-cyan-500/40 text-cyan-300 hover:shadow-[0_0_12px_rgba(34,211,238,0.55)]"
                                : "bg-slate-800/50 border-slate-700/60 text-slate-500 cursor-not-allowed"
                        )}
                        aria-label={`Start ${defaultPomoDurationMinutes} minute Pomodoro`}
                        title={`Start ${defaultPomoDurationMinutes} minute Pomodoro`}
                    >
                        <Timer className="h-4 w-4" />
                    </button>

                    {canDelete && (
                        <button
                            type="button"
                            disabled={isDeleting}
                            onClick={() => onDelete?.(task)}
                            className="h-8 w-8 rounded-md border flex items-center justify-center transition-colors bg-red-950/30 hover:bg-red-900/40 border-red-900/50 text-red-400"
                            aria-label="Delete task"
                            title="Delete task"
                        >
                            <Trash2 className="h-4 w-4" />
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
