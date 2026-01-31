import { getPendingVouchRequests, getFailedTasks, getAssignedTasksForVoucher } from "@/actions/voucher";
import VoucherDashboardClient from "./voucher-dashboard-client";

export default async function VoucherPage() {
    const pendingTasks = await getPendingVouchRequests();
    const failedTasks = await getFailedTasks();
    const assignedTasks = await getAssignedTasksForVoucher();

    return (
        <VoucherDashboardClient
            pendingTasks={pendingTasks}
            failedTasks={failedTasks}
            assignedTasks={assignedTasks}
        />
    );
}
