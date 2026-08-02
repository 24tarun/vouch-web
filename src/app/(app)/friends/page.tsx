import { getWorkingFriendActivities } from "@/actions/friends";
import { getPendingVouchRequests } from "@/actions/voucher";
import VoucherDashboardClient from "../voucher/voucher-dashboard-client";
import { getPendingRectificationsForVoucher } from "@/actions/rectification";

export default async function FriendsPage() {
    const [pendingTasks, workingFriends, pendingRectifications] = await Promise.all([
        getPendingVouchRequests(),
        getWorkingFriendActivities(),
        getPendingRectificationsForVoucher(),
    ]);

    return (
        <VoucherDashboardClient
            pendingTasks={pendingTasks}
            workingFriends={workingFriends}
            pendingRectifications={pendingRectifications as any}
        />
    );
}
