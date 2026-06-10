import type { Task } from "./types";
import type { TaskStatus } from "./xstate/task-machine";

const ACTIVE_PENDING_STATUS_SET = new Set<TaskStatus>(["ACTIVE", "POSTPONED"]);
const ACTIVE_VISIBILITY_DAY_COUNT = 2;

export function canVoucherSeeTask(
    task: Pick<Task, "status" | "deadline"> & { user?: { voucher_can_view_active_tasks?: boolean } | null },
    reference: Date = new Date()
): boolean {
    if (!ACTIVE_PENDING_STATUS_SET.has(task.status)) return true;

    if (task.user?.voucher_can_view_active_tasks !== true) return false;
    const deadlineMs = Date.parse(task.deadline);
    if (Number.isNaN(deadlineMs)) return false;
    const startOfToday = new Date(reference);
    startOfToday.setHours(0, 0, 0, 0);
    const visibilityEnd = new Date(startOfToday);
    visibilityEnd.setDate(visibilityEnd.getDate() + ACTIVE_VISIBILITY_DAY_COUNT);
    return deadlineMs >= startOfToday.getTime() && deadlineMs < visibilityEnd.getTime();
}
