import { revalidateTag } from "next/cache";

export function activeTasksTag(userId: string): string {
    return `tasks:active:${userId}`;
}

export function pendingVoucherRequestsTag(voucherId: string): string {
    return `voucher:pending:${voucherId}`;
}

export function invalidateActiveTasksCache(userId: string) {
    revalidateTag(activeTasksTag(userId), "max");
}

export function invalidatePendingVoucherRequestsCache(voucherId: string) {
    revalidateTag(pendingVoucherRequestsTag(voucherId), "max");
}
