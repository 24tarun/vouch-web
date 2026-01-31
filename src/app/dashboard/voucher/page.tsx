import { getPendingVouchRequests, getFailedTasks } from "@/actions/voucher";
import VoucherDashboardClient from "./voucher-dashboard-client";

export default async function VoucherPage() {
    const pendingTasks = await getPendingVouchRequests();
    const failedTasks = await getFailedTasks();

    return (
        <VoucherDashboardClient
            pendingTasks={pendingTasks}
            failedTasks={failedTasks}
        />
    );
}
