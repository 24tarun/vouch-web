"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { Task } from "@/lib/types";
import { Timer } from "lucide-react";

type StatsTask = Task & { pomo_total_seconds?: number };

export function CompactStatsItem({ task }: { task: StatsTask }) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const statusColors: Record<string, string> = {
        CREATED: "text-blue-400",
        POSTPONED: "text-amber-400",
        MARKED_COMPLETED: "text-yellow-400",
        AWAITING_VOUCHER: "text-yellow-400",
        COMPLETED: "text-lime-300",          // Brighter neon green
        FAILED: "text-red-500",              // Bright Red
        RECTIFIED: "text-orange-500",        // Bright Orange
        SETTLED: "text-cyan-400",            // Bright Cyan
        DELETED: "text-slate-500",           // Brighter Grey
    };

    const statusLabels: Record<string, string> = {
        CREATED: "ACTIVE",
        POSTPONED: "POSTPONED",
        MARKED_COMPLETED: "WAITING FOR VOUCHER",
        AWAITING_VOUCHER: "WAITING FOR VOUCHER",
        COMPLETED: "ACCEPTED",
        FAILED: "FAILED",
        RECTIFIED: "RECTIFIED",
        SETTLED: "FORCE MAJEURE",
        DELETED: "DELETED",
    };

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        const day = d.getDate().toString().padStart(2, '0');
        const month = (d.getMonth() + 1).toString().padStart(2, '0');
        const year = d.getFullYear();
        const hours = d.getHours().toString().padStart(2, '0');
        const minutes = d.getMinutes().toString().padStart(2, '0');
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

    if (!mounted) {
        return (
            <div className="flex items-center gap-3 py-6 border-b border-slate-900 last:border-0 -mx-4 px-4 h-[100px]">
                <div className="flex-1 animate-pulse bg-slate-900/10 rounded h-12"></div>
            </div>
        );
    }

    return (
        <div className="group flex items-center gap-3 py-6 border-b border-slate-900 last:border-0 -mx-4 px-4 transition-colors hover:bg-slate-900/10 relative">
            {/* Clickable Area for main content */}
            <Link href={`/dashboard/tasks/${task.id}`} className="absolute inset-0 z-0" />

            <div className="flex-1 min-w-0 z-10 pointer-events-none">
                <div className="flex items-center gap-2">
                    <p className="text-lg font-medium text-white group-hover:text-blue-400 transition-colors truncate">
                        {task.title}
                    </p>
                    <Badge variant="outline" className={`text-[9px] h-4 py-0 px-1 border-slate-900 uppercase tracking-tighter ${statusColors[task.status] || "text-slate-500"}`}>
                        {task.status === "FAILED"
                            ? (task.marked_completed_at ? "DENIED" : "FAILED")
                            : (statusLabels[task.status] || task.status)}
                    </Badge>
                    {pomoTotalSeconds > 0 && (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30 text-[10px]">
                            <Timer className="h-3 w-3 mr-1" />
                            {formatPomoBadge(pomoTotalSeconds)}
                        </Badge>
                    )}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                    {["CREATED", "POSTPONED"].includes(task.status)
                        ? `Deadline on ${formatDate(task.deadline)}`
                        : `Updated on ${formatDate(task.updated_at)}`}
                </p>
            </div>

            <div className="flex flex-col items-end z-10 pointer-events-none gap-2">
                <span className={`text-base font-mono ${task.status === 'FAILED' ? 'text-red-500' : 'text-slate-400'}`}>
                    {task.status === 'FAILED' ? '-' : ''}€{(task.failure_cost_cents / 100).toFixed(2)}
                </span>
            </div>
        </div>
    );
}
