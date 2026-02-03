import { createClient } from "@/lib/supabase/server";
import { TaskInput } from "@/components/TaskInput";
import { TaskRow } from "@/components/TaskRow";
import { CollapsibleCompletedList } from "@/components/CollapsibleCompletedList";
import type { Task } from "@/lib/types";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getFriends } from "@/actions/friends";

export default async function DashboardPage() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    // Fetch friends for TaskInput
    const friends = await getFriends();

    // @ts-ignore
    const { data: tasks } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", user?.id as any)
        .order("created_at", { ascending: false });

    const activeTasks =
        (tasks as Task[])?.filter((t) =>
            ["CREATED", "POSTPONED"].includes(t.status)
        ) || [];

    const completedTasks =
        (tasks as Task[])?.filter((t) =>
            ["COMPLETED", "AWAITING_VOUCHER", "RECTIFIED", "SETTLED", "FAILED", "DELETED"].includes(t.status)
        ) || [];

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                    Inbox
                </h1>
                <div className="flex items-center gap-2">
                    {/* Placeholder for sorting or menu if needed later */}
                    <Button variant="ghost" size="icon" className="text-slate-400 hover:text-white" disabled>
                        <ArrowUpDown className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {/* Input */}
            <TaskInput friends={friends} />

            {/* Active Tasks List */}
            <div className="flex flex-col">
                {activeTasks.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-slate-500 text-sm">All tasks completed! Relax or add more.</p>
                    </div>
                ) : (
                    activeTasks.map((task) => (
                        <TaskRow key={task.id} task={task} />
                    ))
                )}
            </div>

            {/* Completed Tasks */}
            {completedTasks.length > 0 && (
                <CollapsibleCompletedList tasks={completedTasks} />
            )}
        </div>
    );
}
