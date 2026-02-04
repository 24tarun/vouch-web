"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { Task } from "@/lib/types";

export function CompactStatsItem({ task }: { task: Task }) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const statusColors: Record<string, string> = {
        CREATED: "text-blue-400",
        POSTPONED: "text-amber-400",
        MARKED_COMPLETED: "text-yellow-400",
        AWAITING_VOUCHER: "text-yellow-400",
        COMPLETED: "text-[#859900]",       // Green
        FAILED: "text-[#dc322f]",          // Red
        RECTIFIED: "text-[#cb4b16]",       // Orange
        SETTLED: "text-[#2aa198]",         // Cyan
        DELETED: "text-slate-600",         // Grey
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

    if (!mounted) {
        return (
            <div className="flex items-center gap-3 py-6 border-b border-slate-900 last:border-0 -mx-4 px-4 h-[100px]">
                <div className="flex-1 animate-pulse bg-slate-900/10 rounded h-12"></div>
            </div>
        );
    }

    return (
        <Link href={`/dashboard/tasks/${task.id}`} className="group block">
            <div className="flex items-center gap-3 py-6 border-b border-slate-900 last:border-0 hover:bg-slate-900/10 -mx-4 px-4 transition-colors">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <p className="text-lg font-medium text-slate-300 group-hover:text-slate-100 transition-colors truncate">
                            {task.title}
                        </p>
                        <Badge variant="outline" className={`text-[9px] h-4 py-0 px-1 border-slate-900 uppercase tracking-tighter ${statusColors[task.status] || "text-slate-500"}`}>
                            {task.status === "FAILED"
                                ? (task.marked_completed_at ? "DENIED" : "FAILED")
                                : (statusLabels[task.status] || task.status)}
                        </Badge>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">
                        {["CREATED", "POSTPONED"].includes(task.status)
                            ? `Deadline on ${formatDate(task.deadline)}`
                            : `Updated on ${formatDate(task.updated_at)}`}
                    </p>
                </div>

                <div className="flex flex-col items-end">
                    <span className={`text-base font-mono ${task.status === 'FAILED' ? 'text-red-500' : 'text-slate-700'}`}>
                        {task.status === 'FAILED' ? '-' : ''}€{(task.failure_cost_cents / 100).toFixed(2)}
                    </span>
                    <span className="text-[10px] text-slate-700 uppercase tracking-widest mt-1">
                        Stake
                    </span>
                </div>
            </div>
        </Link>
    );
}
