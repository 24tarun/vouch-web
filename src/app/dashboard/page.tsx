import { createClient } from "@/lib/supabase/server";
import type { Task } from "@/lib/types";
import { getFriends } from "@/actions/friends";
import { DEFAULT_FAILURE_COST_CENTS } from "@/lib/constants";
import DashboardClient from "@/app/dashboard/dashboard-client";

export default async function DashboardPage() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    const userId = user?.id;

    // Fetch friends for TaskInput
    const friends = await getFriends();

    const { data: rawProfileDefaults } = await supabase
        .from("profiles")
        .select("default_failure_cost_cents, default_voucher_id")
        .eq("id", userId || "")
        .maybeSingle();
    const profileDefaults = rawProfileDefaults as {
        default_failure_cost_cents: number | null;
        default_voucher_id: string | null;
    } | null;

    const defaultFailureCostEuros = (
        ((profileDefaults?.default_failure_cost_cents ?? DEFAULT_FAILURE_COST_CENTS) / 100)
    ).toFixed(2);
    const defaultVoucherId = profileDefaults?.default_voucher_id ?? null;

    const { data: tasks } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", userId || "")
        .order("created_at", { ascending: false });

    return (
        <DashboardClient
            initialTasks={(tasks as Task[]) || []}
            friends={friends}
            defaultFailureCostEuros={defaultFailureCostEuros}
            defaultVoucherId={defaultVoucherId}
            userId={userId || ""}
        />
    );
}
