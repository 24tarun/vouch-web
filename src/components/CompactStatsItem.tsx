"use client";

import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import {
    StatsPomoBadge,
    StatsRecurringBadge,
    TaskStatusBadge,
} from "@/design-system/badges";
import type { TaskStatus } from "@/lib/xstate/task-machine";

export interface CompactStatsTask {
    id: string;
    title: string;
    status: string;
    deadline: string;
    updated_at?: string | null;
    marked_completed_at?: string | null;
    voucher_timeout_auto_accepted?: boolean | null;
    proof_request_open?: boolean | null;
    recurrence_rule_id?: string | null;
    voucher?: {
        username?: string | null;
    } | null;
    pomo_total_seconds?: number;
}

const PREFETCH_STATUSES = new Set(["ACTIVE", "POSTPONED", "AWAITING_VOUCHER", "AWAITING_AI", "MARKED_COMPLETE", "AWAITING_USER"]);

interface CompactStatsItemProps {
    task: CompactStatsTask;
    forceActiveBadge?: boolean;
    onRowClick?: () => void;
}

const TASK_STATUS_VALUE_SET = new Set<TaskStatus>([
    "ACTIVE",
    "POSTPONED",
    "MARKED_COMPLETE",
    "AWAITING_VOUCHER",
    "AWAITING_AI",
    "AI_DENIED",
    "AWAITING_USER",
    "ESCALATED",
    "ACCEPTED",
    "AUTO_ACCEPTED",
    "AI_ACCEPTED",
    "DENIED",
    "MISSED",
    "RECTIFIED",
    "DELETED",
    "SETTLED",
]);

function resolveStatsBadgeStatus(status: string, forceActiveBadge: boolean): TaskStatus {
    if (forceActiveBadge && (status === "ACTIVE" || status === "POSTPONED")) {
        return "ACTIVE";
    }
    if (TASK_STATUS_VALUE_SET.has(status as TaskStatus)) {
        return status as TaskStatus;
    }
    return "DELETED";
}

export function CompactStatsItem({
    task,
    forceActiveBadge = false,
    onRowClick,
}: CompactStatsItemProps) {
    const router = useRouter();
    const detailPath = `/tasks/${task.id}`;

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
    const isActiveTask = task.status === "ACTIVE" || task.status === "POSTPONED";
    const hasOpenProofRequest =
        Boolean(task.proof_request_open) &&
        (task.status === "AWAITING_VOUCHER" || task.status === "AWAITING_AI" || task.status === "MARKED_COMPLETE");
    const proofRequestedByLabel = task.voucher?.username || "Your voucher";
    const shouldPrefetchDetail = PREFETCH_STATUSES.has(task.status);
    const statusBadge = resolveStatsBadgeStatus(task.status, forceActiveBadge);
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
                if (onRowClick) { event.stopPropagation(); onRowClick(); return; }
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
                    <TaskStatusBadge status={statusBadge} className="font-medium tracking-normal" />
                    {task.recurrence_rule_id && (
                        <StatsRecurringBadge />
                    )}
                    {!isActiveTask && (
                        <StatsPomoBadge totalSeconds={pomoTotalSeconds} />
                    )}
                </div>
                <p className="text-xs text-slate-400 mt-1" suppressHydrationWarning>
                    {["ACTIVE", "POSTPONED"].includes(task.status)
                        ? `Deadline on ${formatDate(task.deadline)}`
                        : `Updated on ${formatDate(task.updated_at || task.deadline)}`}
                </p>
                {hasOpenProofRequest && (
                    <p className="text-xs text-pink-400 mt-2">
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
