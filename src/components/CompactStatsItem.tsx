"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Timer } from "lucide-react";
import { formatPomoBadge } from "@/lib/format-pomo";

export interface CompactStatsTask {
    id: string;
    title: string;
    status: string;
    deadline: string;
    updated_at?: string | null;
    marked_completed_at?: string | null;
    voucher_timeout_auto_accepted?: boolean | null;
    proof_request_open?: boolean | null;
    voucher?: {
        username?: string | null;
    } | null;
    pomo_total_seconds?: number;
}

const PREFETCH_STATUSES = new Set(["CREATED", "POSTPONED", "AWAITING_VOUCHER", "MARKED_COMPLETED"]);

interface CompactStatsItemProps {
    task: CompactStatsTask;
    forceActiveBadge?: boolean;
}

export function CompactStatsItem({
    task,
    forceActiveBadge = false,
}: CompactStatsItemProps) {
    const router = useRouter();
    const detailPath = `/dashboard/tasks/${task.id}`;

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
        FAILED: "FAILED",
        RECTIFIED: "RECTIFIED",
        SETTLED: "FORCE MAJEURE",
        DELETED: "DELETED",
    };

    const formatDate = (dateStr: string | null | undefined) => {
        if (!dateStr) return "Unknown date";
        const d = new Date(dateStr);
        if (Number.isNaN(d.getTime())) return "Unknown date";
        const day = d.getDate().toString().padStart(2, "0");
        const month = (d.getMonth() + 1).toString().padStart(2, "0");
        const year = d.getFullYear();
        const hours = d.getHours().toString().padStart(2, "0");
        const minutes = d.getMinutes().toString().padStart(2, "0");
        return `${day}/${month}/${year} at ${hours}:${minutes}`;
    };

    const pomoTotalSeconds = task.pomo_total_seconds || 0;
    const statusColorClass = statusColors[task.status] || "text-slate-500";
    const isActiveTask = task.status === "CREATED" || task.status === "POSTPONED";
    const hasOpenProofRequest =
        Boolean(task.proof_request_open) &&
        (task.status === "AWAITING_VOUCHER" || task.status === "MARKED_COMPLETED");
    const proofRequestedByLabel = task.voucher?.username || "Your voucher";
    const shouldPrefetchDetail = PREFETCH_STATUSES.has(task.status);
    const openTaskDetails = () => {
        router.push(detailPath);
    };

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
                if (!shouldPrefetchDetail) return;
                void router.prefetch(detailPath);
            }}
        >
            <div className="flex-1 min-w-0 z-10">
                <div className="flex items-center gap-2">
                    <p className="text-lg font-medium text-white group-hover:text-blue-400 transition-colors truncate">
                        {task.title}
                    </p>
                    {forceActiveBadge && isActiveTask && (
                        <Badge variant="outline" className="text-[9px] h-4 py-0 px-1 border-slate-900 uppercase tracking-tighter text-blue-400">
                            ACTIVE
                        </Badge>
                    )}
                    {!(forceActiveBadge && task.status === "CREATED") && (
                        <Badge variant="outline" className={`text-[9px] h-4 py-0 px-1 border-slate-900 uppercase tracking-tighter ${statusColorClass}`}>
                            {task.status === "FAILED"
                                ? (task.marked_completed_at ? "DENIED" : "FAILED")
                                : task.status === "COMPLETED"
                                    ? (task.voucher_timeout_auto_accepted ? "VOUCHER DID NOT RESPOND" : "ACCEPTED")
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
                        : `Updated on ${formatDate(task.updated_at || task.deadline)}`}
                </p>
                {hasOpenProofRequest && (
                    <p className="text-xs text-amber-300 mt-2">
                        {proofRequestedByLabel} has asked for proof.
                    </p>
                )}
            </div>

            <div className="relative z-20 flex items-center gap-2">
                <button
                    type="button"
                    onClick={openTaskDetails}
                    className="h-8 w-8 rounded-md border flex items-center justify-center transition-colors bg-slate-900/60 border-slate-700/80 text-slate-300 hover:text-white hover:bg-slate-800"
                    aria-label="Open task details"
                    title="Open task details"
                >
                    <ExternalLink className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}
