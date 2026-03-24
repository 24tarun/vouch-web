import { isTaskScheduledForTodayOrTomorrow } from "./dashboard-task-buckets";
import type { Task } from "./types";
import type { TaskStatus } from "./xstate/task-machine";

const ACTIVE_PENDING_STATUS_SET = new Set<TaskStatus>(["ACTIVE", "POSTPONED"]);

export function canVoucherSeeTask(
    task: Pick<Task, "status" | "deadline"> & { user?: { voucher_can_view_active_tasks?: boolean } | null },
    reference: Date = new Date()
): boolean {
    if (!ACTIVE_PENDING_STATUS_SET.has(task.status)) return true;

    return task.user?.voucher_can_view_active_tasks === true &&
        isTaskScheduledForTodayOrTomorrow(task, reference);
}
