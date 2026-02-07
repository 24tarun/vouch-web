import { createClient } from "@/lib/supabase/server";
import type { Task } from "@/lib/types";
import { getFriends } from "@/actions/friends";
import { DEFAULT_FAILURE_COST_CENTS } from "@/lib/constants";
import DashboardClient from "@/app/dashboard/dashboard-client";
import { getCachedActiveTasksForUser } from "@/actions/tasks";
import { BuildStamp } from "@/components/BuildStamp";

export default async function DashboardPage() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    const userId = user?.id;

    const finalStatuses = ["COMPLETED", "AWAITING_VOUCHER", "RECTIFIED", "SETTLED", "FAILED", "DELETED"];

    const [friends, rawProfileDefaults, activeTasks, completedTasksResult] = await Promise.all([
        getFriends(),
        supabase
            .from("profiles")
            .select("default_failure_cost_cents, default_voucher_id, username")
            .eq("id", userId || "")
            .maybeSingle()
            .then((result) => result.data),
        getCachedActiveTasksForUser(userId || ""),
        supabase
            .from("tasks")
            .select("*")
            .eq("user_id", userId || "")
            .in("status", finalStatuses)
            .order("updated_at", { ascending: false })
            .limit(10),
    ]);

    const profileDefaults = rawProfileDefaults as {
        default_failure_cost_cents: number | null;
        default_voucher_id: string | null;
        username: string | null;
    } | null;

    const defaultFailureCostEuros = (
        ((profileDefaults?.default_failure_cost_cents ?? DEFAULT_FAILURE_COST_CENTS) / 100)
    ).toFixed(2);
    const defaultVoucherId = profileDefaults?.default_voucher_id ?? null;
    const username =
        profileDefaults?.username?.trim() ||
        ((user?.user_metadata as { username?: string } | undefined)?.username?.trim() ?? "") ||
        (user?.email?.split("@")[0] ?? "there");

    const completedTasks = (completedTasksResult.data as Task[] | null) || [];
    const completedTaskIds = new Set(completedTasks.map((task) => task.id));
    const dedupedActiveTasks = (((activeTasks as Task[]) || []).filter(
        (task) => !completedTaskIds.has(task.id)
    ));
    const initialTasks = [...dedupedActiveTasks, ...completedTasks];

    return (
        <>
            <DashboardClient
                initialTasks={initialTasks}
                friends={friends}
                defaultFailureCostEuros={defaultFailureCostEuros}
                defaultVoucherId={defaultVoucherId}
                userId={userId || ""}
                username={username}
            />
            <BuildStamp className="pointer-events-none fixed bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] left-1/2 -translate-x-1/2 text-[10px] tracking-[0.04em] text-slate-600 font-mono z-40" />
        </>
    );
}
