import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Task } from "@/lib/types";

export default async function DashboardPage() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    // @ts-ignore
    const { data: tasks } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", user?.id as any)
        .order("created_at", { ascending: false });

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
            ["CREATED", "POSTPONED"].includes(t.status)
        ) || [];

    const historyTasks =
        (tasks as Task[])?.filter((t) =>
            !["CREATED", "POSTPONED"].includes(t.status)
        ) || [];

    const completedCount = tasks?.filter((t: Task) => t.status === "COMPLETED").length || 0;

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-white">Dashboard</h1>
                    <p className="text-slate-400 mt-1">
                        Manage your tasks and accountability
                    </p>
                </div>
                <Link href="/dashboard/tasks/new">
                    <Button className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700">
                        + New Task
                    </Button>
                </Link>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="pb-2">
                        <CardDescription className="text-slate-400">
                            Active Tasks
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-3xl font-bold text-white">{activeTasks.length}</p>
                    </CardContent>
                </Card>

                <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="pb-2">
                        <CardDescription className="text-slate-400">
                            Pending Vouches
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-3xl font-bold text-purple-400">
                            {vouchRequests?.length || 0}
                        </p>
                    </CardContent>
                </Card>

                <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="pb-2">
                        <CardDescription className="text-slate-400">
                            Completed
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-3xl font-bold text-green-400">
                            {completedCount}
                        </p>
                    </CardContent>
                </Card>

                <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="pb-2">
                        <CardDescription className="text-slate-400">
                            Projected Donation
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-3xl font-bold text-pink-400">
                            €{(totalFailureCost / 100).toFixed(2)}
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Vouch Requests Alert */}
            {vouchRequests && vouchRequests.length > 0 && (
                <Card className="bg-purple-900/30 border-purple-500/50">
                    <CardHeader>
                        <CardTitle className="text-purple-300 flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-purple-400 animate-pulse" />
                            Vouch Requests Pending
                        </CardTitle>
                        <CardDescription className="text-purple-200/70">
                            You have {vouchRequests.length} task(s) waiting for your review
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Link href="/dashboard/voucher">
                            <Button
                                variant="outline"
                                className="border-purple-500 text-purple-300 hover:bg-purple-500/20"
                            >
                                Review Now
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
            )}

            {/* Active Tasks */}
            <div>
                <h2 className="text-xl font-semibold text-white mb-4">🔥 Active Tasks</h2>
                {activeTasks.length === 0 ? (
                    <Card className="bg-slate-800/50 border-slate-700">
                        <CardContent className="py-8 text-center">
                            <p className="text-slate-400 mb-4">No active tasks</p>
                            <Link href="/dashboard/tasks/new">
                                <Button
                                    variant="outline"
                                    className="border-slate-600 text-slate-300"
                                >
                                    Create a task
                                </Button>
                            </Link>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-3">
                        {activeTasks.map((task: Task) => (
                            <TaskCard key={task.id} task={task} />
                        ))}
                    </div>
                )}
            </div>

            {/* Task History */}
            {historyTasks.length > 0 && (
                <div>
                    <h2 className="text-xl font-semibold text-slate-400 mb-4">📋 History</h2>
                    <div className="grid gap-2">
                        {historyTasks.map((task: Task) => (
                            <TaskCard key={task.id} task={task} variant="history" />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function TaskCard({ task, variant = "active" }: { task: Task; variant?: "active" | "history" }) {
    const statusConfig: Record<string, { color: string; icon: string; label: string }> = {
        CREATED: { color: "bg-blue-500", icon: "🎯", label: "Active" },
        POSTPONED: { color: "bg-yellow-500", icon: "⏸️", label: "Postponed" },
        MARKED_COMPLETED: { color: "bg-purple-500", icon: "⏳", label: "Waiting" },
        AWAITING_VOUCHER: { color: "bg-purple-500", icon: "⏳", label: "Waiting" },
        COMPLETED: { color: "bg-green-500", icon: "✅", label: "Accepted" },
        FAILED: { color: "bg-red-500", icon: "❌", label: "Denied / Failed" },
        RECTIFIED: { color: "bg-orange-500", icon: "🔄", label: "Rectified" },
        SETTLED: { color: "bg-slate-600", icon: "📁", label: "Settled" },
        DELETED: { color: "bg-slate-600", icon: "🗑️", label: "Deleted" },
    };

    const config = statusConfig[task.status] || { color: "bg-slate-500", icon: "❓", label: task.status };
    const deadline = new Date(task.deadline);
    const isOverdue = deadline < new Date() && !["COMPLETED", "FAILED", "RECTIFIED", "SETTLED", "DELETED"].includes(task.status);

    const cardStyles = {
        active: "bg-slate-800/50 border-slate-700 hover:border-purple-500/50",
        history: "bg-slate-800/30 border-slate-700/50 opacity-70 hover:opacity-100",
    };

    return (
        <Link href={`/dashboard/tasks/${task.id}`}>
            <Card className={`${cardStyles[variant]} transition-all cursor-pointer`}>
                <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                        <div className="flex-1">
                            <div className="flex items-center gap-3">
                                <span className="text-lg">{config.icon}</span>
                                <h3 className={`font-medium ${variant === "history" ? "text-slate-300" : "text-white"}`}>
                                    {task.title}
                                </h3>
                                <Badge className={`${config.color} text-white text-xs`}>
                                    {config.label}
                                </Badge>
                            </div>
                            <div className="flex items-center gap-4 mt-2 text-sm text-slate-400">
                                <span className={isOverdue ? "text-red-400" : ""}>
                                    {variant === "history" ? "Deadline:" : "Due:"} {deadline.toLocaleDateString()} {deadline.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </span>
                                <span>Stake: €{(task.failure_cost_cents / 100).toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </Link>
    );
}
