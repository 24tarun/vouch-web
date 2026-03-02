import type { Task } from "@/lib/types";

export interface ResolvedTaskWindow {
    startAt: Date | null;
    endAt: Date;
    isTimed: boolean;
    isLegacyTimed: boolean;
}

function parseIsoDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
}

export function resolveTaskWindow(task: Pick<Task, "deadline" | "start_at" | "google_event_end_at">): ResolvedTaskWindow | null {
    const deadline = parseIsoDate(task.deadline);
    if (!deadline) return null;

    const startAt = parseIsoDate(task.start_at);
    if (startAt && startAt.getTime() < deadline.getTime()) {
        return {
            startAt,
            endAt: deadline,
            isTimed: true,
            isLegacyTimed: false,
        };
    }

    const legacyEnd = parseIsoDate(task.google_event_end_at);
    if (legacyEnd && legacyEnd.getTime() > deadline.getTime()) {
        return {
            startAt: deadline,
            endAt: legacyEnd,
            isTimed: true,
            isLegacyTimed: true,
        };
    }

    return {
        startAt: null,
        endAt: deadline,
        isTimed: false,
        isLegacyTimed: false,
    };
}

export function resolveTaskSortAnchor(task: Pick<Task, "deadline" | "start_at" | "google_event_end_at">): Date | null {
    const window = resolveTaskWindow(task);
    if (!window) return null;
    return window.startAt ?? window.endAt;
}
