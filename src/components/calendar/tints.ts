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

/** Solid block fill per status: exactly the status dot colours above. */
export function statusFillColor(status: CalendarStatus): string {
    switch (status) {
        case "ACTIVE":
        case "ESCALATED":
            return "#60a5fa"; // blue-400
        case "POSTPONED":
            return "#66A3FF";
        case "MARKED_COMPLETE":
        case "ACCEPTED":
        case "AUTO_ACCEPTED":
        case "AI_ACCEPTED":
            return "#34d399"; // emerald-400
        case "AWAITING_VOUCHER":
        case "AWAITING_AI":
            return "#fbbf24"; // amber-400
        case "AWAITING_USER":
        case "RECTIFIED":
            return "#fb923c"; // orange-400
        case "AWAITING_RECTIFICATION":
            return "#a78bfa"; // violet-400
        case "SETTLED":
            return "#e879f9"; // fuchsia-400
        case "AI_DENIED":
        case "DENIED":
        case "MISSED":
        case "SURRENDERED":
            return "#ef4444"; // red-500
        case "GHOST":
            return "#64748b"; // slate-500
        default:
            return "#94a3b8"; // slate-400
    }
}
