import { createClient } from "@/lib/supabase/server";
import type { Task } from "@/lib/types";
import { getFriends } from "@/actions/friends";
import { DEFAULT_FAILURE_COST_CENTS, DEFAULT_POMO_DURATION_MINUTES } from "@/lib/constants";
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
            .select("default_failure_cost_cents, default_voucher_id, default_pomo_duration_minutes, username, hide_tips")
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
        default_pomo_duration_minutes: number | null;
        username: string | null;
        hide_tips: boolean | null;
    } | null;

    const defaultFailureCostEuros = (
        ((profileDefaults?.default_failure_cost_cents ?? DEFAULT_FAILURE_COST_CENTS) / 100)
    ).toFixed(2);
    const defaultPomoDurationMinutes =
        Number.isInteger(profileDefaults?.default_pomo_duration_minutes) &&
            (profileDefaults?.default_pomo_duration_minutes ?? 0) > 0
            ? (profileDefaults?.default_pomo_duration_minutes as number)
            : DEFAULT_POMO_DURATION_MINUTES;
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
    const pomoTotalSecondsByTask = new Map<string, number>();
    if (initialTaskIds.length > 0) {
        const [{ data: subtasksResult }, { data: pomoResult }] = await Promise.all([
            supabase
                .from("task_subtasks")
                .select("*")
                .in("parent_task_id", initialTaskIds),
            supabase
                .from("pomo_sessions")
                .select("task_id, elapsed_seconds")
                .eq("user_id", userId || "")
                .in("task_id", initialTaskIds)
                .neq("status", "DELETED"),
        ]);

        for (const row of (subtasksResult as NonNullable<Task["subtasks"]>) || []) {
            const list = subtasksByParent.get(row.parent_task_id) || [];
            list.push(row);
            subtasksByParent.set(row.parent_task_id, list);
        }

        for (const row of ((pomoResult as Array<{ task_id: string; elapsed_seconds: number }> | null) || [])) {
            if (!row.task_id) continue;
            const current = pomoTotalSecondsByTask.get(row.task_id) || 0;
            pomoTotalSecondsByTask.set(row.task_id, current + (row.elapsed_seconds || 0));
        }
    }

    const initialTasksWithSubtasks = initialTasks.map((task) => ({
        ...task,
        subtasks: (subtasksByParent.get(task.id) || []).slice().sort((a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        ),
        pomo_total_seconds: pomoTotalSecondsByTask.get(task.id) || 0,
    }));

    return (
        <div className="flex min-h-[calc(100dvh-8rem)] flex-col">
            <div className="flex-1">
                <DashboardClient
                    initialTasks={initialTasksWithSubtasks}
                    friends={friends}
                    defaultFailureCostEuros={defaultFailureCostEuros}
                    defaultVoucherId={defaultVoucherId}
                    defaultPomoDurationMinutes={defaultPomoDurationMinutes}
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
