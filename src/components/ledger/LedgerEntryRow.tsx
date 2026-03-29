import { formatCurrencyFromCents, type SupportedCurrency } from "@/lib/currency";
import { TaskStatusBadge } from "@/design-system/badges";
import type { TaskStatus } from "@/lib/xstate/task-machine";
import { ExternalLink } from "lucide-react";
import Link from "next/link";

interface LedgerEntryRowProps {
    id?: string;
    title: string;
    entryType: string;
    taskStatus?: string | null;
    createdAt: string | Date;
    amountCents: number;
    currency: SupportedCurrency;
    taskHref?: string | null;
    compact?: boolean;
}

const TASK_STATUS_VALUE_SET = new Set<TaskStatus>([
    "ACTIVE",
    "POSTPONED",
    "MARKED_COMPLETE",
    "AWAITING_VOUCHER",
    "AWAITING_ORCA",
    "ORCA_DENIED",
    "AWAITING_USER",
    "ESCALATED",
    "ACCEPTED",
    "AUTO_ACCEPTED",
    "ORCA_ACCEPTED",
    "DENIED",
    "MISSED",
    "RECTIFIED",
    "DELETED",
    "SETTLED",
]);

function resolveLedgerBadgeStatus(entryType: string, taskStatus?: string | null): TaskStatus {
    if (entryType === "failure") {
        return taskStatus === "DENIED" ? "DENIED" : "MISSED";
    }
    if (entryType === "rectified") return "RECTIFIED";
    if (entryType === "override" || entryType === "force_majeure") return "SETTLED";
    if (entryType === "voucher_timeout_penalty") return "AWAITING_VOUCHER";
    if (taskStatus && TASK_STATUS_VALUE_SET.has(taskStatus as TaskStatus)) {
        return taskStatus as TaskStatus;
    }
    return "DELETED";
}

export function LedgerEntryRow({
    id,
    title,
    entryType,
    taskStatus,
    createdAt,
    amountCents,
    currency,
    taskHref,
    compact = false,
}: LedgerEntryRowProps) {
    const absAmountLabel = formatCurrencyFromCents(Math.abs(amountCents), currency);
    const createdAtDate = new Date(createdAt);
    const rowId = id || `${entryType}-${String(createdAt)}-${title}`;
    const badgeStatus = resolveLedgerBadgeStatus(entryType, taskStatus);

    return (
        <div
            key={rowId}
            className={`group flex items-center gap-3 ${compact ? "py-5 border-b border-slate-900/50" : "py-6 border-b border-slate-900"} last:border-0 hover:bg-slate-900/10 -mx-4 px-4 transition-colors`}
        >
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <p className={`${compact ? "text-base" : "text-lg"} font-medium text-slate-300 group-hover:text-slate-100 transition-colors truncate`}>
                        {title}
                    </p>
                    <TaskStatusBadge status={badgeStatus} className="font-medium tracking-normal" />
                    {taskHref && (
                        <Link
                            href={taskHref}
                            prefetch
                            className="h-7 w-7 p-0 text-slate-300 hover:text-white hover:bg-slate-800 rounded-md transition-colors inline-flex items-center justify-center"
                            aria-label="Open task"
                            title="Open task"
                        >
                            <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                    )}
                </div>
                <p className="text-xs text-slate-600 mt-1">
                    {createdAtDate.toLocaleDateString()} at {createdAtDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
            </div>

            <div className="flex flex-col items-end">
                <span className={`${compact ? "text-lg" : "text-xl"} font-mono ${amountCents > 0 ? "text-red-500" : "text-green-500"}`}>
                    {amountCents > 0 ? "+" : "-"}{absAmountLabel}
                </span>
                <span className="text-[10px] text-slate-700 uppercase tracking-widest mt-1">
                    {amountCents < 0 ? "Reversal" : "Amount"}
                </span>
            </div>
        </div>
    );
}
