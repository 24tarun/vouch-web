import { createClient } from "@/lib/supabase/server";
import type { TaskWithRelations } from "@/lib/types";
import { HardRefreshButton } from "@/components/HardRefreshButton";
import { StatsActiveTaskList } from "@/components/StatsActiveTaskList";
import { StatsHistoryTaskList } from "@/components/StatsHistoryTaskList";
import { sortStatsActiveTasks } from "@/lib/stats-active-task-sort";

const ACTIVE_SECTION_STATUSES = new Set([
    "ACTIVE",
    "POSTPONED",
    "MARKED_COMPLETE",
    "AWAITING_VOUCHER",
    "AWAITING_AI",
    "AWAITING_USER",
    "ESCALATED",
]);

export default async function OverviewPage() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    const userId = user?.id ?? "";

    const [tasksResult, pomoSessionsResult] = await Promise.all([
        supabase
            .from("tasks")
            .select("*, voucher:profiles!tasks_voucher_id_fkey(id, username, email)")
            .eq("user_id", userId)
            .order("updated_at", { ascending: false }),
        supabase
            .from("pomo_sessions")
            .select("task_id, elapsed_seconds")
            .eq("user_id", userId)
            .neq("status", "DELETED"),
    ]);

    const rawTasks = (tasksResult.data as TaskWithRelations[] | null) || [];
    const taskIds = rawTasks.map((task) => task.id).filter(Boolean);
    const proofByTaskId = new Map<string, TaskWithRelations["completion_proof"]>();

    if (taskIds.length > 0) {
        const { data: proofsResult } = await supabase
            .from("task_completion_proofs")
            .select("*")
            .in("task_id", taskIds)
            .eq("upload_state", "UPLOADED");

        for (const row of ((proofsResult as TaskWithRelations["completion_proof"][] | null) || [])) {
            if (!row?.task_id) continue;
            proofByTaskId.set(row.task_id, row);
        }
    }

    const tasks = rawTasks.map((task) => ({
        ...task,
        completion_proof: proofByTaskId.get(task.id) || null,
    }));
    const allSessions = (pomoSessionsResult.data as Array<{
        task_id: string;
        elapsed_seconds: number;
    }> | null) || [];

    const taskStatusById = new Map(tasks.map((task) => [task.id, task.status]));
    const validSessions = allSessions.filter((session) => {
        const status = taskStatusById.get(session.task_id);
        return status !== "DENIED" && status !== "MISSED" && status !== "DELETED";
    });

    const totalSeconds = validSessions.reduce((sum, session) => sum + (session.elapsed_seconds || 0), 0);
    const totalHours = Math.floor(totalSeconds / 3600);
    const totalMinutes = Math.floor((totalSeconds % 3600) / 60);

    const activeTasks = sortStatsActiveTasks(tasks.filter((t) => ACTIVE_SECTION_STATUSES.has(t.status)));

    const activeTasksCount = activeTasks.length;
    const pendingVouchCount = tasks.filter((t) =>
        ["AWAITING_VOUCHER", "AWAITING_AI", "MARKED_COMPLETE"].includes(t.status)
    ).length;
    const acceptedCount = tasks.filter((t) => ["ACCEPTED", "AUTO_ACCEPTED", "AI_ACCEPTED"].includes(t.status)).length;
    const failedCount = tasks.filter((t) => t.status === "MISSED").length;
    const deniedCount = tasks.filter((t) => t.status === "DENIED").length;

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
        <div className="max-w-4xl mx-auto space-y-12 pb-20 px-4 md:px-0">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h1 className="text-3xl font-bold text-white">Overview</h1>
                </div>
                <HardRefreshButton />
            </div>

            {/* Quick Stats Grid - High Contrast, No Frames */}
            <div className="grid grid-cols-3 gap-4 md:flex md:items-baseline md:justify-between md:gap-8">
                <div className="space-y-1 md:whitespace-nowrap">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Active</p>
                    <p className="text-2xl sm:text-3xl md:text-4xl font-light text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.6)]">{activeTasksCount}</p>
                </div>
                <div className="space-y-1 md:whitespace-nowrap">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Time Focused</p>
                    <p className="text-2xl sm:text-3xl md:text-4xl font-light text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.6)] whitespace-nowrap">
                        {totalHours}
                        <span className="text-base sm:text-lg md:text-xl text-slate-500 ml-1">h</span>{" "}
                        {totalMinutes}
                        <span className="text-base sm:text-lg md:text-xl text-slate-500 ml-1">m</span>
                    </p>
                </div>
                <div className="space-y-1 md:whitespace-nowrap">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Pending Vouches</p>
                    <p className="text-2xl sm:text-3xl md:text-4xl font-light text-purple-400 drop-shadow-[0_0_8px_rgba(192,132,252,0.6)]">{pendingVouchCount}</p>
                </div>
                <div className="space-y-1 md:whitespace-nowrap">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Accepted</p>
                    <p className="text-2xl sm:text-3xl md:text-4xl font-light text-lime-300 drop-shadow-[0_0_8px_rgba(190,242,100,0.6)]">{acceptedCount}</p>
                </div>
                <div className="space-y-1 md:whitespace-nowrap">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Failed</p>
                    <p className="text-2xl sm:text-3xl md:text-4xl font-light text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.6)]">{failedCount}</p>
                </div>
                <div className="space-y-1 md:whitespace-nowrap">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Denied</p>
                    <p className="text-2xl sm:text-3xl md:text-4xl font-light text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.6)]">{deniedCount}</p>
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
                    <div className="flex flex-col">
                        <StatsActiveTaskList
                            initialTasks={activeTasksWithPomo}
                        />
                    </div>
                )}
            </section>

            {/* History Section - Collapsible + paged like voucher history */}
            <StatsHistoryTaskList tasks={historyTasksWithPomo} />
        </div>
    );
}
