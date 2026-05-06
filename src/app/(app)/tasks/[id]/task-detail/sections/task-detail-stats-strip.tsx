import { formatDateTimeDdMmYy, formatFocusTime } from "@/app/(app)/tasks/[id]/task-detail/utils/task-detail-helpers";
import { TaskStatusBadge } from "@/design-system";
import type { TaskStatus } from "@/lib/xstate/task-machine";

interface TaskDetailStatsStripProps {
    deadline: Date;
    status: TaskStatus;
    formattedFailureCost: string;
    isAiVouched: boolean;
    isSelfVouched: boolean;
    voucherUsername: string | null | undefined;
    totalPomoSeconds: number;
    sessionCount: number;
}

export function TaskDetailStatsStrip({
    deadline,
    status,
    formattedFailureCost,
    isAiVouched,
    isSelfVouched,
    voucherUsername,
    totalPomoSeconds,
    sessionCount,
}: TaskDetailStatsStripProps) {
    return (
        <div className="td-rise td-d2 rounded-xl border border-slate-800/80 bg-slate-950/40 px-4 py-4 sm:px-5">
            <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-3 min-h-[32px]">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Status</p>
                    <TaskStatusBadge status={status} />
                </div>
                <div className="flex items-center justify-between gap-3 min-h-[32px]">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Deadline</p>
                    <p className="text-xs font-mono text-right text-slate-200">{formatDateTimeDdMmYy(deadline)}</p>
                </div>
                <div className="flex items-center justify-between gap-3 min-h-[32px]">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Failure Cost</p>
                    <p className="text-xs font-mono text-slate-200 text-right">{formattedFailureCost}</p>
                </div>
                <div className="flex items-center justify-between gap-3 min-h-[32px]">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Voucher</p>
                    <p className="text-xs font-mono text-slate-200 text-right truncate">
                        {isAiVouched ? "AI" : (isSelfVouched ? "Self" : (voucherUsername || "Unassigned"))}
                    </p>
                </div>
                <div className="flex items-center justify-between gap-3 min-h-[32px]">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Focused</p>
                    <p className="text-xs font-mono text-slate-200 text-right">
                        {`${formatFocusTime(totalPomoSeconds)}, ${sessionCount} session${sessionCount === 1 ? "" : "s"}`}
                    </p>
                </div>
            </div>
        </div>
    );
}
