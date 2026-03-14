import type { VoucherPendingTask } from "@/lib/types";

function parseTimestamp(value: string | null | undefined): number | null {
    if (!value) return null;
    const ts = new Date(value).getTime();
    return Number.isNaN(ts) ? null : ts;
}

export function sortPendingTasks(tasks: VoucherPendingTask[]): VoucherPendingTask[] {
    return [...tasks].sort((a, b) => {
        const aDeadlineTs = parseTimestamp(a.pending_deadline_at);
        const bDeadlineTs = parseTimestamp(b.pending_deadline_at);
        const aUpdatedTs = parseTimestamp(a.updated_at) || 0;
        const bUpdatedTs = parseTimestamp(b.updated_at) || 0;

        // Primary sort: most recently updated first.
        if (aUpdatedTs !== bUpdatedTs) return bUpdatedTs - aUpdatedTs;

        // Tie-breaker: earliest pending deadline first.
        if (aDeadlineTs === null && bDeadlineTs === null) return 0;
        if (aDeadlineTs === null) return 1;
        if (bDeadlineTs === null) return -1;
        return aDeadlineTs - bDeadlineTs;
    });
}

