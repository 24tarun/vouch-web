import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import type { Task } from "@/lib/types";

export default async function OverviewPage() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    // @ts-ignore
    const { data: tasks } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", user?.id as any)
        .order("updated_at", { ascending: false });

    // @ts-ignore
    const { data: vouchRequests } = await supabase
        .from("tasks")
        .select("*")
        .eq("voucher_id", user?.id as any)
        .eq("status", "AWAITING_VOUCHER");

    // Get ledger summary for current month
    const currentPeriod = new Date().toISOString().slice(0, 7);
    // @ts-ignore
    const { data: ledgerEntries } = await supabase
        .from("ledger_entries")
        .select("*")
        .eq("user_id", user?.id as any)
        .eq("period", currentPeriod);

    const totalFailureCost =
        (ledgerEntries as any)?.reduce((sum: number, entry: any) => sum + entry.amount_cents, 0) || 0;

    const activeTasksCount =
        (tasks as Task[])?.filter((t) =>
            ["CREATED", "POSTPONED", "AWAITING_VOUCHER", "MARKED_COMPLETED"].includes(t.status)
        ).length || 0;

    const completedTasks =
        (tasks as Task[])?.filter((t) =>
            ["COMPLETED", "FAILED", "RECTIFIED", "SETTLED", "DELETED"].includes(t.status)
        ) || [];

    const historyTasksCount = completedTasks.length;

    return (
        <div className="max-w-4xl mx-auto space-y-12 pb-20 mt-12 px-4 md:px-0">
            <div>
                <h1 className="text-3xl font-bold text-white">Overview</h1>
                <p className="text-slate-400 mt-1">
                    Your performance and habit reliability
                </p>
            </div>

            {/* Quick Stats Grid - High Contrast, No Frames */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Active</p>
                    <p className="text-4xl font-light text-white">{activeTasksCount}</p>
                </div>
                <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">History</p>
                    <p className="text-4xl font-light text-white">{historyTasksCount}</p>
                </div>
                <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Pending Vouches</p>
                    <p className="text-4xl font-light text-purple-400">{vouchRequests?.length || 0}</p>
                </div>
                <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Monthly Loss</p>
                    <p className="text-4xl font-light text-red-500">€{(totalFailureCost / 100).toFixed(2)}</p>
                </div>
            </div>

            {/* History Section - Same List Principle as Vouch/Dashboard */}
            <section className="space-y-4">
                <h2 className="text-xl font-semibold text-slate-500 border-b border-slate-900 pb-2">
                    Settled Task History
                </h2>
                {completedTasks.length === 0 ? (
                    <div className="bg-slate-900/40 border border-slate-800/20 rounded-xl py-12 text-center">
                        <p className="text-slate-600 text-sm italic">Nothing in your history yet.</p>
                    </div>
                ) : (
                    <div className="flex flex-col border-t border-slate-900/50">
                        {completedTasks.map((task: Task) => (
                            <CompactStatsItem key={task.id} task={task} />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}

function CompactStatsItem({ task }: { task: Task }) {
    const statusColors: Record<string, string> = {
        COMPLETED: "text-[#859900]",       // Green
        FAILED: "text-[#dc322f]",          // Red
        RECTIFIED: "text-[#cb4b16]",       // Orange
        SETTLED: "text-[#2aa198]",         // Cyan
        DELETED: "text-slate-600",         // Grey
    };

    const statusLabels: Record<string, string> = {
        COMPLETED: "ACCEPTED",
        FAILED: "FAILED",
        RECTIFIED: "RECTIFIED",
        SETTLED: "FORCE MAJEURE",
        DELETED: "DELETED",
    };

    return (
        <Link href={`/dashboard/tasks/${task.id}`} className="group block">
            <div className="flex items-center gap-3 py-6 border-b border-slate-900 last:border-0 hover:bg-slate-900/10 -mx-4 px-4 transition-colors">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <p className="text-lg font-medium text-slate-300 group-hover:text-slate-100 transition-colors truncate">
                            {task.title}
                        </p>
                        <Badge variant="outline" className={`text-[9px] h-4 py-0 px-1 border-slate-900 uppercase tracking-tighter ${statusColors[task.status] || "text-slate-500"}`}>
                            {task.status === "FAILED"
                                ? (task.marked_completed_at ? "DENIED" : "FAILED")
                                : (statusLabels[task.status] || task.status)}
                        </Badge>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">
                        Settled on {new Date(task.updated_at).toLocaleDateString()} at {new Date(task.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                </div>

                <div className="flex flex-col items-end">
                    <span className={`text-base font-mono ${task.status === 'FAILED' ? 'text-red-500' : 'text-slate-700'}`}>
                        {task.status === 'FAILED' ? '-' : ''}€{(task.failure_cost_cents / 100).toFixed(2)}
                    </span>
                    <span className="text-[10px] text-slate-700 uppercase tracking-widest mt-1">
                        Stake
                    </span>
                </div>
            </div>
        </Link>
    );
}
