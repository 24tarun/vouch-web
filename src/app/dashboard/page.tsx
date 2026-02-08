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
            .select("default_failure_cost_cents, default_voucher_id, username, hide_tips")
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
        hide_tips: boolean | null;
    } | null;

    const defaultFailureCostEuros = (
        ((profileDefaults?.default_failure_cost_cents ?? DEFAULT_FAILURE_COST_CENTS) / 100)
    ).toFixed(2);
    const defaultVoucherId = profileDefaults?.default_voucher_id ?? null;
    const username =
        profileDefaults?.username?.trim() ||
        ((user?.user_metadata as { username?: string } | undefined)?.username?.trim() ?? "") ||
        (user?.email?.split("@")[0] ?? "there");
    const initialHideTips = profileDefaults?.hide_tips ?? false;

    const completedTasks = (completedTasksResult.data as Task[] | null) || [];
    const completedTaskIds = new Set(completedTasks.map((task) => task.id));
    const dedupedActiveTasks = (((activeTasks as Task[]) || []).filter(
        (task) => !completedTaskIds.has(task.id)
    ));
    const initialTasks = [...dedupedActiveTasks, ...completedTasks];
    const initialTaskIds = initialTasks.map((task) => task.id);

    const subtasksByParent = new Map<string, NonNullable<Task["subtasks"]>>();
    if (initialTaskIds.length > 0) {
        const { data: subtasksResult } = await supabase
            .from("task_subtasks")
            .select("*")
            .in("parent_task_id", initialTaskIds);

        for (const row of (subtasksResult as NonNullable<Task["subtasks"]>) || []) {
            const list = subtasksByParent.get(row.parent_task_id) || [];
            list.push(row);
            subtasksByParent.set(row.parent_task_id, list);
        }
    }

    const initialTasksWithSubtasks = initialTasks.map((task) => ({
        ...task,
        subtasks: (subtasksByParent.get(task.id) || []).slice().sort((a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        ),
    }));

    return (
        <div className="flex min-h-[calc(100dvh-8rem)] flex-col">
            <div className="flex-1">
                <DashboardClient
                    initialTasks={initialTasksWithSubtasks}
                    friends={friends}
                    defaultFailureCostEuros={defaultFailureCostEuros}
                    defaultVoucherId={defaultVoucherId}
                    userId={userId || ""}
                    username={username}
                    initialHideTips={initialHideTips}
                />
            </div>
            <div className="pt-6 pb-safe">
                <BuildStamp className="text-center text-[10px] leading-4 tracking-[0.03em] text-slate-400 font-mono" />
            </div>
        </div>
    );
}
