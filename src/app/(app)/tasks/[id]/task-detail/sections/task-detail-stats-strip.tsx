import { formatDateTimeDdMmYy, formatFocusTime } from "@/app/(app)/tasks/[id]/task-detail/utils/task-detail-helpers";
import { Pencil } from "lucide-react";
import { TaskStatusBadge } from "@/design-system";
import type { TaskStatus } from "@/lib/xstate/task-machine";
import type { RecurrenceEditorField } from "@/app/(app)/tasks/[id]/task-detail/paused-recurrence-editor-dialog";

interface TaskDetailStatsStripProps {
    deadline: Date;
    status: TaskStatus;
    formattedFailureCost: string;
    voucherLabel: string;
    totalPomoSeconds: number;
    sessionCount: number;
    proofRequired: boolean;
    canEditFutureRepetitions?: boolean;
    highlightedFields?: ReadonlySet<RecurrenceEditorField>;
    onEditFutureSetting?: (field: RecurrenceEditorField) => void;
}

export function TaskDetailStatsStrip({
    deadline,
    status,
    formattedFailureCost,
    voucherLabel,
    totalPomoSeconds,
    sessionCount,
    proofRequired,
    canEditFutureRepetitions = false,
    highlightedFields,
    onEditFutureSetting,
}: TaskDetailStatsStripProps) {
    const editButton = (field: RecurrenceEditorField, label: string) => (
        <button
            type="button"
            onClick={() => onEditFutureSetting?.(field)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-purple-400 transition-colors hover:bg-purple-400/10 hover:text-purple-300"
            aria-label={`Edit ${label} for future repetitions`}
            title={`Edit ${label} for future repetitions`}
        >
            <Pencil className="h-3.5 w-3.5" />
        </button>
    );
    const isHighlighted = (field: RecurrenceEditorField) =>
        canEditFutureRepetitions && Boolean(highlightedFields?.has(field));
    const valueClassName = (field: RecurrenceEditorField) =>
        isHighlighted(field) ? "text-purple-400" : "text-slate-200";

    return (
        <div className="td-rise td-d2 rounded-xl border border-slate-800/80 bg-slate-950/40 px-4 py-4 sm:px-5">
            <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-3 min-h-[32px]">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Status</p>
                    <TaskStatusBadge status={status} />
                </div>
                <div className="flex items-center justify-between gap-3 min-h-[32px]">
                    <div className="flex items-center gap-1.5">
                        {canEditFutureRepetitions && editButton("deadline", "deadline")}
                        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Deadline</p>
                    </div>
                    <p
                        className={`text-xs font-mono text-right ${valueClassName("deadline")}`}
                        data-highlighted={isHighlighted("deadline") || undefined}
                    >
                        {formatDateTimeDdMmYy(deadline)}
                    </p>
                </div>
                <div className="flex items-center justify-between gap-3 min-h-[32px]">
                    <div className="flex items-center gap-1.5">
                        {canEditFutureRepetitions && editButton("failureCost", "failure cost")}
                        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Failure Cost</p>
                    </div>
                    <p
                        className={`text-xs font-mono text-right ${valueClassName("failureCost")}`}
                        data-highlighted={isHighlighted("failureCost") || undefined}
                    >
                        {formattedFailureCost}
                    </p>
                </div>
                <div className="flex items-center justify-between gap-3 min-h-[32px]">
                    <div className="flex items-center gap-1.5">
                        {canEditFutureRepetitions && editButton("voucher", "voucher")}
                        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Voucher</p>
                    </div>
                    <p
                        className={`min-w-0 truncate text-right font-mono text-xs ${valueClassName("voucher")}`}
                        data-highlighted={isHighlighted("voucher") || undefined}
                    >
                        {voucherLabel}
                    </p>
                </div>
                <div className="flex items-center justify-between gap-3 min-h-[32px]">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Focused</p>
                    <p className="text-xs font-mono text-slate-200 text-right">
                        {`${formatFocusTime(totalPomoSeconds)}, ${sessionCount} session${sessionCount === 1 ? "" : "s"}`}
                    </p>
                </div>
                <div className="flex items-center justify-between gap-3 min-h-[32px]">
                    <div className="flex items-center gap-1.5">
                        {canEditFutureRepetitions && editButton("requiresProof", "proof requirement")}
                        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Proof Required</p>
                    </div>
                    <p
                        className={`text-xs font-mono text-right ${valueClassName("requiresProof")}`}
                        data-highlighted={isHighlighted("requiresProof") || undefined}
                    >
                        {proofRequired ? "True" : "False"}
                    </p>
                </div>
            </div>
        </div>
    );
}
