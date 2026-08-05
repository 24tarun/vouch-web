import type { TaskStatus } from "@/lib/xstate/task-machine";

export const OWNER_TEMP_DELETE_WINDOW_MS = 60 * 60 * 1000;

type TaskDeleteCandidate = {
    status: TaskStatus;
    created_at: string;
    recurrence_rule_id?: string | null;
};

export function isOwnerTempDeletableStatus(status: TaskStatus): boolean {
    return status === "ACTIVE" || status === "POSTPONED";
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

    // A recurring occurrence is governed by its recurrence rule. Allowing the
    // one-hour creation grace period here would let an owner erase a freshly
    // generated instance (most visibly at midnight) without stopping or
    // pausing the series.
    if (task.recurrence_rule_id) {
        return false;
    }

    return getOwnerDeleteRemainingMs(task.created_at, nowMs) > 0;
}

export function canOwnerSurrenderTask(task: TaskDeleteCandidate, nowMs: number = Date.now()): boolean {
    if (!isOwnerTempDeletableStatus(task.status)) {
        return false;
    }

    const createdAtMs = new Date(task.created_at).getTime();
    if (Number.isNaN(createdAtMs)) {
        return false;
    }

    return nowMs - createdAtMs >= OWNER_TEMP_DELETE_WINDOW_MS;
}
