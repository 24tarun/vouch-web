import { createClient } from "@/lib/supabase/server";
import type { Task } from "@/lib/types";
import { CompactStatsItem } from "@/components/CompactStatsItem";
import { HardRefreshButton } from "@/components/HardRefreshButton";
import { DEFAULT_POMO_DURATION_MINUTES } from "@/lib/constants";
import { StatsActiveTaskList } from "@/components/StatsActiveTaskList";

const ACTIVE_SECTION_STATUSES = new Set(["CREATED", "POSTPONED", "AWAITING_VOUCHER", "MARKED_COMPLETED"]);

export default async function OverviewPage() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    const userId = user?.id ?? "";

    const [tasksResult, pomoSessionsResult, profileResult] = await Promise.all([
        supabase
            .from("tasks")
            .select("*")
            .eq("user_id", userId)
            .order("updated_at", { ascending: false }),
        supabase
            .from("pomo_sessions")
            .select("task_id, elapsed_seconds")
            .eq("user_id", userId)
            .neq("status", "DELETED"),
        supabase
            .from("profiles")
            .select("default_pomo_duration_minutes")
            .eq("id", userId)
            .maybeSingle(),
    ]);

    const tasks = (tasksResult.data as Task[] | null) || [];
    const profile = profileResult.data as { default_pomo_duration_minutes: number | null } | null;
    const defaultPomoDurationMinutes =
        profile?.default_pomo_duration_minutes ?? DEFAULT_POMO_DURATION_MINUTES;
    const allSessions = (pomoSessionsResult.data as Array<{
        task_id: string;
        elapsed_seconds: number;
    }> | null) || [];

    const taskStatusById = new Map(tasks.map((task) => [task.id, task.status]));
    const validSessions = allSessions.filter((session) => {
        const status = taskStatusById.get(session.task_id);
        return status !== "FAILED" && status !== "DELETED";
    });

    const totalSeconds = validSessions.reduce((sum, session) => sum + (session.elapsed_seconds || 0), 0);
    const totalHours = Math.floor(totalSeconds / 3600);
    const totalMinutes = Math.floor((totalSeconds % 3600) / 60);

    const activeTasks = tasks.filter((t) => ACTIVE_SECTION_STATUSES.has(t.status));

    const activeTasksCount = activeTasks.length;
    const pendingVouchCount = tasks.filter((t) =>
        ["AWAITING_VOUCHER", "MARKED_COMPLETED"].includes(t.status)
    ).length;
    const acceptedCount = tasks.filter((t) => t.status === "COMPLETED").length;
    const failedCount = tasks.filter((t) => t.status === "FAILED" && !t.marked_completed_at).length;
    const deniedCount = tasks.filter((t) => t.status === "FAILED" && Boolean(t.marked_completed_at)).length;

    const historyTasks = tasks.filter((t) => !ACTIVE_SECTION_STATUSES.has(t.status));

    const taskPomoTotals = allSessions.reduce((map, row) => {
        if (!row.task_id) return map;
        const current = map.get(row.task_id) || 0;
        map.set(row.task_id, current + (row.elapsed_seconds || 0));
        return map;
    }, new Map<string, number>());

    const activeTasksWithPomo = activeTasks.map((task) => ({
        ...task,
        pomo_total_seconds: taskPomoTotals.get(task.id) || 0,
    }));

    const historyTasksWithPomo = historyTasks.map((task) => ({
        ...task,
        pomo_total_seconds: taskPomoTotals.get(task.id) || 0,
    }));

    return (
        <div className="max-w-4xl mx-auto space-y-12 pb-20 mt-12 px-4 md:px-0">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h1 className="text-3xl font-bold text-white">Overview</h1>
                    <p className="text-slate-400 mt-1">
                        Your performance and habit reliability
                    </p>
                </div>
                <HardRefreshButton />
            </div>

            {/* Quick Stats Grid - High Contrast, No Frames */}
            <div className="grid grid-cols-3 gap-4 md:flex md:items-baseline md:justify-between md:gap-8">
                <div className="space-y-1 md:whitespace-nowrap">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Active</p>
                    <p className="text-2xl sm:text-3xl md:text-4xl font-light text-white">{activeTasksCount}</p>
                </div>
                <div className="space-y-1 md:whitespace-nowrap">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Time Focused</p>
                    <p className="text-2xl sm:text-3xl md:text-4xl font-light text-white whitespace-nowrap">
                        {totalHours}
                        <span className="text-base sm:text-lg md:text-xl text-slate-500 ml-1">h</span>{" "}
                        {totalMinutes}
                        <span className="text-base sm:text-lg md:text-xl text-slate-500 ml-1">m</span>
                    </p>
                </div>
                <div className="space-y-1 md:whitespace-nowrap">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Pending Vouches</p>
                    <p className="text-2xl sm:text-3xl md:text-4xl font-light text-purple-400">{pendingVouchCount}</p>
                </div>
                <div className="space-y-1 md:whitespace-nowrap">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Accepted</p>
                    <p className="text-2xl sm:text-3xl md:text-4xl font-light text-lime-300">{acceptedCount}</p>
                </div>
                <div className="space-y-1 md:whitespace-nowrap">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Failed</p>
                    <p className="text-2xl sm:text-3xl md:text-4xl font-light text-red-500">{failedCount}</p>
                </div>
                <div className="space-y-1 md:whitespace-nowrap">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Denied</p>
                    <p className="text-2xl sm:text-3xl md:text-4xl font-light text-red-500">{deniedCount}</p>
                </div>
            </div>

            {/* Active Tasks Section */}
            <section className="space-y-4">
                <h2 className="text-xl font-semibold text-slate-500 border-b border-slate-900 pb-2">
                    Active Tasks
                </h2>
                {activeTasks.length === 0 ? (
                    <div className="bg-slate-900/40 border border-slate-800/20 rounded-xl py-12 text-center">
                        <p className="text-slate-600 text-sm italic">No active tasks at the moment.</p>
                    </div>
                ) : (
                    <div className="flex flex-col border-t border-slate-900/50">
                        <StatsActiveTaskList
                            initialTasks={activeTasksWithPomo}
                            defaultPomoDurationMinutes={defaultPomoDurationMinutes}
                        />
                    </div>
                )}
            </section>

            {/* History Section - Same List Principle as Vouch/Dashboard */}
            <section className="space-y-4">
                <h2 className="text-xl font-semibold text-slate-500 border-b border-slate-900 pb-2">
                    Task History
                </h2>
                {historyTasks.length === 0 ? (
                    <div className="bg-slate-900/40 border border-slate-800/20 rounded-xl py-12 text-center">
                        <p className="text-slate-600 text-sm italic">Nothing in your history yet.</p>
                    </div>
                ) : (
                    <div className="flex flex-col border-t border-slate-900/50">
                        {historyTasksWithPomo.map((task: Task & { pomo_total_seconds?: number }) => (
                            <CompactStatsItem key={task.id} task={task} />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
