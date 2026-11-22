import type { TaskStatus } from "@/lib/xstate/task-machine";

export type CalendarStatus = TaskStatus | "GHOST";

/** Status dot colours, matching the status pills on the tasks page. */
export function statusDotClass(status: CalendarStatus): string {
    switch (status) {
        case "ACTIVE":
        case "ESCALATED":
            return "bg-blue-400";
        case "POSTPONED":
            return "bg-[#66A3FF]";
        case "MARKED_COMPLETE":
        case "ACCEPTED":
        case "AUTO_ACCEPTED":
        case "AI_ACCEPTED":
            return "bg-emerald-400";
        case "AWAITING_VOUCHER":
        case "AWAITING_AI":
            return "bg-amber-400";
        case "AWAITING_USER":
        case "RECTIFIED":
            return "bg-orange-400";
        case "AWAITING_RECTIFICATION":
            return "bg-violet-400";
        case "SETTLED":
            return "bg-fuchsia-400";
        case "AI_DENIED":
        case "DENIED":
        case "MISSED":
        case "SURRENDERED":
            return "bg-red-500";
        case "GHOST":
            return "bg-slate-500";
        default:
            return "bg-slate-400";
    }
}

/** Same glow as the active Friends tab in the nav. */
export const TODAY_GLOW_STYLE = {
    textShadow: "0 0 10px rgba(147, 197, 253, 0.95), 0 0 22px rgba(59, 130, 246, 0.85)",
} as const;

/** Solid block fill per status (same hues as the status pills, at full strength). */
export function statusFillColor(status: CalendarStatus): string {
    switch (status) {
        case "ACTIVE":
        case "ESCALATED":
            return "#2563eb"; // blue-600
        case "POSTPONED":
            return "#0066FF";
        case "MARKED_COMPLETE":
        case "ACCEPTED":
        case "AUTO_ACCEPTED":
        case "AI_ACCEPTED":
            return "#059669"; // emerald-600
        case "AWAITING_VOUCHER":
        case "AWAITING_AI":
            return "#d97706"; // amber-600
        case "AWAITING_USER":
        case "RECTIFIED":
            return "#ea580c"; // orange-600
        case "AWAITING_RECTIFICATION":
            return "#7c3aed"; // violet-600
        case "SETTLED":
            return "#a21caf"; // fuchsia-700
        case "AI_DENIED":
        case "DENIED":
        case "MISSED":
        case "SURRENDERED":
            return "#dc2626"; // red-600
        case "GHOST":
            return "#334155"; // slate-700
        default:
            return "#475569"; // slate-600
    }
}
