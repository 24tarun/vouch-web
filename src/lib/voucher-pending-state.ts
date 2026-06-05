import type { VoucherPendingTask } from "@/lib/types";
import type { TaskStatus } from "@/lib/xstate/task-machine";
import { isIncomingNewer } from "@/lib/tasks-realtime-patch";

const ACTIVE_PENDING_STATUSES = new Set<TaskStatus>(["ACTIVE", "POSTPONED"]);
const ACTIONABLE_PENDING_STATUSES = new Set<TaskStatus>(["AWAITING_VOUCHER", "MARKED_COMPLETE"]);

export function getVoucherPendingDisplayType(status: TaskStatus): VoucherPendingTask["pending_display_type"] {
    return ACTIVE_PENDING_STATUSES.has(status) ? "ACTIVE" : "AWAITING_VOUCHER";
}

export function deriveVoucherPendingDeadline(task: {
    status: TaskStatus;
    deadline: string;
    voucher_response_deadline: string | null;
    marked_completed_at: string | null;
}): string | null {
    if (ACTIVE_PENDING_STATUSES.has(task.status)) {
        return task.deadline || null;
    }

    if (task.voucher_response_deadline) return task.voucher_response_deadline;
    if (!task.marked_completed_at) return null;

    const derived = new Date(task.marked_completed_at);
    if (Number.isNaN(derived.getTime())) return null;
    derived.setDate(derived.getDate() + 2);
    derived.setHours(23, 59, 59, 999);
    return derived.toISOString();
}

export function isVoucherPendingActionable(status: TaskStatus): boolean {
    return ACTIONABLE_PENDING_STATUSES.has(status);
}

export function shouldPreferServerPendingTask(
    liveTask: Pick<VoucherPendingTask, "status" | "updated_at">,
    serverTask: Pick<VoucherPendingTask, "status" | "updated_at">
): boolean {
    const liveIsActivePending = ACTIVE_PENDING_STATUSES.has(liveTask.status);
    const serverIsActivePending = ACTIVE_PENDING_STATUSES.has(serverTask.status);

    if (!serverIsActivePending && liveIsActivePending) {
        return true;
    }

    if (serverIsActivePending && !liveIsActivePending) {
        return isIncomingNewer(liveTask.updated_at, serverTask.updated_at);
    }

    return isIncomingNewer(liveTask.updated_at, serverTask.updated_at);
}
