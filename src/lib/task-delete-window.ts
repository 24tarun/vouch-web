import type { TaskStatus } from "@/lib/xstate/task-machine";

export const OWNER_TEMP_DELETE_WINDOW_MS = 5 * 60 * 1000;

type TaskDeleteCandidate = {
    status: TaskStatus;
    created_at: string;
};

export function isOwnerTempDeletableStatus(status: TaskStatus): boolean {
    return status === "CREATED" || status === "POSTPONED";
}

export function getOwnerDeleteRemainingMs(createdAtIso: string, nowMs: number = Date.now()): number {
    const createdAtMs = new Date(createdAtIso).getTime();
    if (Number.isNaN(createdAtMs)) {
        return 0;
    }

    const elapsedMs = Math.max(0, nowMs - createdAtMs);
    return Math.max(0, OWNER_TEMP_DELETE_WINDOW_MS - elapsedMs);
}

export function canOwnerTemporarilyDelete(task: TaskDeleteCandidate, nowMs: number = Date.now()): boolean {
    if (!isOwnerTempDeletableStatus(task.status)) {
        return false;
    }

    return getOwnerDeleteRemainingMs(task.created_at, nowMs) > 0;
}
