import type { Task } from "@/lib/types";

function parseTimestamp(value: string | null | undefined): number | null {
    if (!value) return null;
    const timestamp = new Date(value).getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
}

function getRecentActionTimestamp(task: Pick<Task, "marked_completed_at" | "updated_at" | "created_at">): number {
    return Math.max(
        parseTimestamp(task.marked_completed_at) ?? 0,
        parseTimestamp(task.updated_at) ?? 0,
        parseTimestamp(task.created_at) ?? 0
    );
}

function getDeadlineTimestamp(task: Pick<Task, "deadline">): number | null {
    return parseTimestamp(task.deadline);
}

export function sortStatsActiveTasks<T extends Pick<Task, "id" | "deadline" | "marked_completed_at" | "updated_at" | "created_at">>(
    tasks: T[]
): T[] {
    return tasks.toSorted((a, b) => {
        const recentActionDiff = getRecentActionTimestamp(b) - getRecentActionTimestamp(a);
        if (recentActionDiff !== 0) return recentActionDiff;

        const deadlineA = getDeadlineTimestamp(a);
        const deadlineB = getDeadlineTimestamp(b);

        if (deadlineA != null && deadlineB != null && deadlineA !== deadlineB) {
            return deadlineA - deadlineB;
        }

        if (deadlineA == null && deadlineB != null) return 1;
        if (deadlineA != null && deadlineB == null) return -1;

        const createdDiff = (parseTimestamp(b.created_at) ?? 0) - (parseTimestamp(a.created_at) ?? 0);
        if (createdDiff !== 0) return createdDiff;

        return a.id.localeCompare(b.id);
    });
}
