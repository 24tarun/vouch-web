import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import type { Task } from "@/lib/types";
import { CompactStatsItem } from "@/components/CompactStatsItem";

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

    const activeTasks =
        (tasks as Task[])?.filter((t) =>
            ["CREATED", "POSTPONED", "AWAITING_VOUCHER", "MARKED_COMPLETED"].includes(t.status)
        ) || [];

    const activeTasksCount = activeTasks.length;

    const historyTasks =
        (tasks as Task[])?.filter((t) =>
            ["COMPLETED", "FAILED", "RECTIFIED", "SETTLED", "DELETED"].includes(t.status)
        ) || [];

    const historyTasksCount = historyTasks.length;

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
                        {activeTasks.map((task: Task) => (
                            <CompactStatsItem key={task.id} task={task} />
                        ))}
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
                        {historyTasks.map((task: Task) => (
                            <CompactStatsItem key={task.id} task={task} />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}


