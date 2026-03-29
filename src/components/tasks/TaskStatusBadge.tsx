import { cn } from "@/lib/utils";
import type { TaskStatus } from "@/lib/xstate/task-machine";
import { Badge } from "@/components/ui/badge";

export function getTaskStatusBadgeClass(status: TaskStatus): string {
    const classes: Record<TaskStatus, string> = {
        ACTIVE: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
        POSTPONED: "bg-[#0066FF]/20 text-[#66A3FF] border border-[#0066FF]/40",
        MARKED_COMPLETE: "bg-amber-400/15 text-amber-400 border border-amber-400/35",
        AWAITING_VOUCHER: "bg-amber-400/15 text-amber-400 border border-amber-400/35",
        AWAITING_ORCA: "bg-amber-400/15 text-amber-400 border border-amber-400/35",
        ORCA_DENIED: "bg-red-500/20 text-red-300 border border-red-500/30",
        AWAITING_USER: "bg-orange-500/20 text-orange-300 border border-orange-500/30",
        ESCALATED: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
        ACCEPTED: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
        AUTO_ACCEPTED: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
        ORCA_ACCEPTED: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
        DENIED: "bg-red-500/20 text-red-300 border border-red-500/30",
        MISSED: "bg-red-500/20 text-red-300 border border-red-500/30",
        RECTIFIED: "bg-orange-500/20 text-orange-300 border border-orange-500/30",
        DELETED: "bg-slate-600/40 text-slate-300 border border-slate-600/50",
        SETTLED: "bg-[#5B0A1E]/35 text-[#F2C7D0] border border-[#5B0A1E]/80",
    };
    return classes[status];
}

export function getTaskStatusDotClass(status: TaskStatus): string {
    const classes: Record<TaskStatus, string> = {
        ACTIVE: "border-blue-400",
        POSTPONED: "border-amber-400",
        MARKED_COMPLETE: "border-amber-400",
        AWAITING_VOUCHER: "border-amber-400",
        AWAITING_ORCA: "border-amber-400",
        ORCA_DENIED: "border-red-500",
        AWAITING_USER: "border-orange-300",
        ESCALATED: "border-yellow-400",
        ACCEPTED: "border-green-400",
        AUTO_ACCEPTED: "border-green-400",
        ORCA_ACCEPTED: "border-green-400",
        DENIED: "border-red-500",
        MISSED: "border-red-500",
        RECTIFIED: "border-orange-500",
        DELETED: "border-slate-600",
        SETTLED: "border-[#5B0A1E]",
    };
    return classes[status];
}

export function formatTaskStatusLabel(status: TaskStatus): string {
    if (status === "AUTO_ACCEPTED") return "AUTO ACCEPTED";
    if (status === "ORCA_ACCEPTED") return "ORCA ACCEPTED";
    if (status === "ORCA_DENIED") return "ORCA DENIED";
    if (status === "SETTLED") return "OVERRIDE";
    return status.replace(/_/g, " ");
}

interface TaskStatusBadgeProps {
    status: TaskStatus;
    className?: string;
}

export function TaskStatusBadge({ status, className }: TaskStatusBadgeProps) {
    const responsiveBadgeSizeClass =
        "min-h-[clamp(20px,2.2vw,24px)] px-[clamp(10px,1.8vw,14px)] py-[clamp(2px,0.35vw,4px)] text-[10px] leading-none";

    return (
        <Badge
            variant="outline"
            className={cn(
                `${responsiveBadgeSizeClass}`,
                getTaskStatusBadgeClass(status),
                className
            )}
        >
            {formatTaskStatusLabel(status)}
        </Badge>
    );
}
