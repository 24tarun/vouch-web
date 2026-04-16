import { Badge } from "@/components/ui/badge";
import { formatPomoBadge } from "@/lib/format-pomo";
import { cn } from "@/lib/utils";
import type { TaskStatus } from "@/lib/xstate/task-machine";
import { Timer } from "lucide-react";
import type { ReactNode } from "react";
import { RecurringIndicator } from "./RecurringIndicator";

const TASK_STATUS_BADGE_SIZE_CLASS =
    "min-h-[clamp(14px,1.5vw,17px)] !px-[clamp(5px,0.9vw,7px)] py-[clamp(1px,0.2vw,2px)] text-[10px] leading-none";
export const ACTIVITY_TIMELINE_META_TEXT_CLASS = "text-xs font-mono text-slate-300";
const CORE_PILL_BASE_CLASS = "py-[1px]";

interface CorePillProps {
    className?: string;
    children: ReactNode;
    title?: string;
    ariaLabel?: string;
}

function CorePill({ className, children, title, ariaLabel }: CorePillProps) {
    return (
        <Badge variant="outline" className={cn(CORE_PILL_BASE_CLASS, className)} title={title} aria-label={ariaLabel}>
            {children}
        </Badge>
    );
}

const TASK_STATUS_BADGE_CLASS_BY_STATUS: Record<TaskStatus, string> = {
    ACTIVE: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
    POSTPONED: "bg-[#0066FF]/20 text-[#66A3FF] border border-[#0066FF]/40",
    MARKED_COMPLETE: "bg-emerald-400/15 text-emerald-400 border border-emerald-400/35",
    AWAITING_VOUCHER: "bg-amber-400/15 text-amber-400 border border-amber-400/35",
    AWAITING_AI: "bg-amber-400/15 text-amber-400 border border-amber-400/35",
    AI_DENIED: "bg-red-500/10 text-red-500 border border-red-500/30",
    AWAITING_USER: "bg-orange-500/20 text-orange-300 border border-orange-500/30",
    ESCALATED: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
    ACCEPTED: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
    AUTO_ACCEPTED: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
    AI_ACCEPTED: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
    DENIED: "bg-red-500/10 text-red-500 border border-red-500/30",
    MISSED: "bg-red-500/10 text-red-500 border border-red-500/30",
    RECTIFIED: "bg-orange-500/20 text-orange-300 border border-orange-500/30",
    DELETED: "bg-slate-600/40 text-slate-300 border border-slate-600/50",
    SETTLED: "bg-fuchsia-700/20 text-fuchsia-300 border border-fuchsia-700/40",
};

function getTaskStatusBadgeClass(status: TaskStatus): string {
    return TASK_STATUS_BADGE_CLASS_BY_STATUS[status];
}

function formatTaskStatusLabel(status: TaskStatus): string {
    if (status === "AUTO_ACCEPTED") return "AUTO ACCEPTED";
    if (status === "AI_ACCEPTED") return "AI ACCEPTED";
    if (status === "AI_DENIED") return "AI DENIED";
    if (status === "SETTLED") return "OVERRIDE";
    return status.replace(/_/g, " ");
}

interface TaskStatusBadgeProps {
    status: TaskStatus;
    className?: string;
}

export function TaskStatusBadge({ status, className }: TaskStatusBadgeProps) {
    return (
        <CorePill
            className={cn(
                TASK_STATUS_BADGE_SIZE_CLASS,
                getTaskStatusBadgeClass(status),
                className
            )}
        >
            {formatTaskStatusLabel(status)}
        </CorePill>
    );
}

const responsiveBadgeSizeClass =
    "min-h-[clamp(14px,1.5vw,17px)] !px-[clamp(5px,0.9vw,7px)] py-[clamp(1px,0.2vw,2px)] leading-none";

interface VoucherDeadlineBadgeProps {
    deadlineLabel: string;
    hasValidDeadline: boolean;
    hoursLeft: number;
}

export function VoucherDeadlineBadge({ deadlineLabel, hasValidDeadline, hoursLeft }: VoucherDeadlineBadgeProps) {
    const deadlineClass = !hasValidDeadline
        ? `bg-slate-500/10 text-slate-400 border-slate-500/20 text-[10px] ${responsiveBadgeSizeClass}`
        : (hoursLeft < 1
            ? `bg-red-500/10 text-red-500 border-red-500/30 text-[10px] ${responsiveBadgeSizeClass}`
            : `bg-purple-500/10 text-purple-400 border-purple-500/30 text-[10px] ${responsiveBadgeSizeClass}`);
    return (
        <CorePill className={deadlineClass}>
            {deadlineLabel}
        </CorePill>
    );
}

interface VoucherPomoAccumulatedBadgeProps {
    totalSeconds: number;
}

export function VoucherPomoAccumulatedBadge({ totalSeconds }: VoucherPomoAccumulatedBadgeProps) {
    if (totalSeconds <= 0) return null;
    return (
        <CorePill className={`bg-emerald-500/10 text-emerald-300 border-emerald-500/30 text-[10px] ${responsiveBadgeSizeClass}`}>
            <Timer className="h-3 w-3 mr-1" />
            {formatPomoBadge(totalSeconds)}
        </CorePill>
    );
}

interface VoucherProofRequestBadgeProps {
    proofRequestCount: number;
}

export function VoucherProofRequestBadge({ proofRequestCount }: VoucherProofRequestBadgeProps) {
    if (proofRequestCount <= 0) return null;
    return (
        <CorePill className={`bg-pink-400/10 text-pink-400 border-pink-400/30 text-[10px] ${responsiveBadgeSizeClass}`}>
            {`?${proofRequestCount}`}
        </CorePill>
    );
}

const ACTIVITY_EVENT_BADGE_CLASS_BY_EVENT_TYPE: Record<string, string> = {
    ACTIVE: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
    CREATED: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
    MARK_COMPLETE: "bg-emerald-400/15 text-emerald-400 border border-emerald-400/35",
    UNDO_COMPLETE: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
    PROOF_UPLOAD_FAILED_REVERT: "bg-pink-400/15 text-pink-400 border border-pink-400/35",
    PROOF_REMOVED: "bg-pink-400/15 text-pink-400 border border-pink-400/35",
    PROOF_REQUESTED: "bg-pink-400/15 text-pink-400 border border-pink-400/35",
    PROOF_UPLOADED: "bg-pink-400/15 text-pink-400 border border-pink-400/35",
    VOUCHER_ACCEPT: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
    VOUCHER_DENY: "bg-red-500/10 text-red-500 border border-red-500/30",
    VOUCHER_DELETE: "bg-slate-600/40 text-slate-300 border border-slate-600/50",
    RECTIFY: "bg-orange-500/20 text-orange-300 border border-orange-500/30",
    OVERRIDE: "bg-[#5B0A1E]/35 text-[#F2C7D0] border border-[#5B0A1E]/80",
    DEADLINE_MISSED: "bg-red-500/10 text-red-500 border border-red-500/30",
    VOUCHER_TIMEOUT: "bg-amber-400/15 text-amber-400 border border-amber-400/35",
    POMO_COMPLETED: "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30",
    DEADLINE_WARNING_1H: "bg-amber-400/15 text-amber-400 border border-amber-400/35",
    DEADLINE_WARNING_10M: "bg-amber-400/15 text-amber-400 border border-amber-400/35",
    GOOGLE_EVENT_CANCELLED: "bg-red-500/20 text-red-300 border border-red-500/30",
    POSTPONE: "bg-amber-400/15 text-amber-400 border border-amber-400/35",
    REPETITION_STOPPED: "bg-purple-400/10 text-purple-400 border border-purple-400/30",
    AI_APPROVE: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
    AI_DENY: "bg-red-500/10 text-red-500 border border-red-500/30",
    AI_DENIED_AUTO_HOP: "bg-orange-500/20 text-orange-300 border border-orange-500/30",
    ESCALATE: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
    AI_ESCALATE_TO_HUMAN: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
    ACCEPT_DENIAL: "bg-red-500/20 text-red-300 border border-red-500/30",
};

function formatActivityEventDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
    if (seconds < 60) return `${seconds}s`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function getActivityEventBadgeClass(eventType: string): string {
    return ACTIVITY_EVENT_BADGE_CLASS_BY_EVENT_TYPE[eventType] ?? "bg-slate-600/30 text-slate-300 border border-slate-600/40";
}

function formatActivityEventLabel(eventType: string, elapsedSeconds?: number): string {
    if (eventType === "ACTIVE" || eventType === "CREATED") return "ACTIVE";
    if (eventType === "MARK_COMPLETE") return "MARKED COMPLETE";
    if (eventType === "POMO_COMPLETED") return `POMO COMPLETED (${formatActivityEventDuration(elapsedSeconds ?? 0)})`;
    if (eventType === "PROOF_UPLOAD_FAILED_REVERT") return "PROOF UPLOAD FAILED";
    if (eventType === "PROOF_REQUESTED") return "PROOF REQUESTED";
    if (eventType === "PROOF_UPLOADED") return "PROOF UPLOADED";
    if (eventType === "PROOF_REMOVED") return "PROOF REMOVED";
    if (eventType === "VOUCHER_ACCEPT") return "ACCEPTED";
    if (eventType === "VOUCHER_DENY") return "DENIED";
    if (eventType === "VOUCHER_DELETE") return "DELETED";
    if (eventType === "RECTIFY") return "RECTIFIED";
    if (eventType === "DEADLINE_MISSED") return "MISSED";
    if (eventType === "AI_APPROVE") return "AI APPROVED";
    if (eventType === "AI_DENY") return "AI DENIED";
    if (eventType === "DEADLINE_WARNING_1H") return "1HR LEFT REMINDER SENT";
    if (eventType === "DEADLINE_WARNING_10M") return "10MIN LEFT REMINDER SENT";
    if (eventType === "REPETITION_STOPPED") return "REPETITIONS STOPPED";
    return eventType.replace(/_/g, " ");
}

interface ActivityEventBadgeProps {
    eventType: string;
    elapsedSeconds?: number;
    className?: string;
}

export function ActivityEventBadge({ eventType, elapsedSeconds, className }: ActivityEventBadgeProps) {
    return (
        <CorePill
            className={cn(
                "h-[16px] px-1 text-[10px] leading-none tracking-wide",
                getActivityEventBadgeClass(eventType),
                className
            )}
        >
            {formatActivityEventLabel(eventType, elapsedSeconds)}
        </CorePill>
    );
}

export function StatsRecurringBadge() {
    return <RecurringIndicator />;
}

interface StatsPomoBadgeProps {
    totalSeconds: number;
}

export function StatsPomoBadge({ totalSeconds }: StatsPomoBadgeProps) {
    if (totalSeconds <= 0) return null;
    return (
        <CorePill className="px-1 py-0 bg-emerald-500/10 text-emerald-300 border-emerald-500/30 text-[10px]">
            <Timer className="h-3 w-3 mr-1" />
            {formatPomoBadge(totalSeconds)}
        </CorePill>
    );
}

const HISTORY_STATUS_TEXT_CLASS_BY_STATUS: Record<string, string> = {
    ACCEPTED: "text-lime-300",
    AUTO_ACCEPTED: "text-lime-300",
    AI_ACCEPTED: "text-lime-300",
    DENIED: "text-[#dc322f]",
    MISSED: "text-[#dc322f]",
    RECTIFIED: "text-[#cb4b16]",
    SETTLED: "text-[#F2C7D0]",
    DELETED: "text-slate-500",
};

function getHistoryTaskStatusTextClass(status: string): string {
    return HISTORY_STATUS_TEXT_CLASS_BY_STATUS[status] || "text-slate-400";
}

interface HistoryTaskStatusBadgeProps {
    status: string;
}

export function HistoryTaskStatusBadge({ status }: HistoryTaskStatusBadgeProps) {
    return (
        <CorePill
            className={cn(
                "text-[10px] h-[13px] py-0 px-0.5 border-slate-800",
                getHistoryTaskStatusTextClass(status)
            )}
        >
            {status === "AUTO_ACCEPTED" ? "VOUCHER DID NOT RESPOND" : status}
        </CorePill>
    );
}
