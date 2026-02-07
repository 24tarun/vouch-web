"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canTransition, type TaskStatus } from "@/lib/xstate/task-machine";
import { sendNotification } from "@/lib/notifications";
import { type Database } from "@/lib/types";
import { type SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export async function voucherAccept(taskId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    // @ts-ignore
    const { data: task } = await (supabase.from("tasks") as any)
        .select("*, user:profiles!tasks_user_id_fkey(id, email, username)")
        .eq("id", (taskId as any))
        .eq("voucher_id", (user as any).id)
        .single();

    if (!task) {
        return { error: "Task not found or you are not the voucher" };
    }

    if (!canTransition((task as any).status as TaskStatus, "VOUCHER_ACCEPT")) {
        return { error: `Cannot accept task in ${(task as any).status} status` };
    }

    // @ts-ignore
    const { error } = await (supabase.from("tasks") as any)
        .update({ status: "COMPLETED" } as any)
        .eq("id", (taskId as any));

    if (error) {
        return { error: error.message };
    }

    // @ts-ignore
    await supabase.from("task_events").insert({
        task_id: taskId as any,
        event_type: "VOUCHER_ACCEPT",
        actor_id: (user as any).id,
        from_status: (task as any).status,
        to_status: "COMPLETED",
    });

    revalidatePath("/dashboard/voucher");
    revalidatePath(`/dashboard/tasks/${taskId}`);
    return { success: true };
}

export async function voucherDeleteTask(taskId: string) {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    // Fetch task with user info, ensure caller is voucher
    // @ts-ignore
    const { data: task } = await (supabase.from("tasks") as any)
        .select(`
      *,
      user:profiles!tasks_user_id_fkey(email, username)
    `)
        .eq("id", (taskId as any))
        .eq("voucher_id", (user as any).id)
        .single();

    if (!task) {
        return { error: "Task not found or you are not the voucher" };
    }

    // Check if task is in a non-final state
    const nonFinalStatuses = [
        "CREATED",
        "POSTPONED",
        "MARKED_COMPLETED",
        "AWAITING_VOUCHER",
    ];
    if (!nonFinalStatuses.includes((task as any).status)) {
        return { error: `Cannot delete task in ${(task as any).status} status` };
    }

    // Update status to DELETED (soft delete)
    const { error } = await (supabase.from("tasks") as any)
        .update({ status: "DELETED", updated_at: new Date().toISOString() } as any)
        .eq("id", (taskId as any))
        .eq("voucher_id", (user as any).id);

    if (error) {
        return { error: error.message };
    }

    // Log the deletion event
    await supabase.from("task_events").insert({
        task_id: taskId as any,
        event_type: "VOUCHER_DELETE",
        actor_id: (user as any).id,
        from_status: (task as any).status,
        to_status: "DELETED",
    } as any);

    // Notify the task owner via email (and push in tandem)
    if ((task as any).user?.email) {
        await sendNotification({
            to: (task as any).user.email,
            userId: (task as any).user.id, // Enable push bridge
            subject: `Task deleted by voucher: ${(task as any).title}`,
            title: "Task Deleted",
            html: `
          <h1>Task Deleted</h1>
          <p>Hi ${(task as any).user.username || "there"},</p>
          <p>Your voucher deleted the task: <strong>${(task as any).title}</strong>.</p>
          <p>If this was unexpected, please reach out to your voucher.</p>
          <br/>
          <a href="${process.env.NEXT_PUBLIC_APP_URL || ""}/dashboard">Go to Vouch</a>
        `,
        });
    }

    revalidatePath("/dashboard/voucher");
    revalidatePath("/dashboard");

    return { success: true };
}

export async function voucherDeny(taskId: string) {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    // @ts-ignore
    const { data: task } = await (supabase.from("tasks") as any)
        .select("*, user:profiles!tasks_user_id_fkey(id, email, username)")
        .eq("id", (taskId as any))
        .eq("voucher_id", (user as any).id)
        .single();

    if (!task) {
        return { error: "Task not found or you are not the voucher" };
    }

    if (!canTransition((task as any).status as TaskStatus, "VOUCHER_DENY")) {
        return { error: `Cannot deny task in ${(task as any).status} status` };
    }

    // Add to ledger
    const currentPeriod = new Date().toISOString().slice(0, 7);

    // @ts-ignore
    const { error } = await (supabase.from("tasks") as any)
        .update({ status: "FAILED" } as any)
        .eq("id", (taskId as any));

    if (error) {
        return { error: error.message };
    }

    // Create ledger entry
    await (supabase.from("ledger_entries" as any) as any).insert({
        user_id: (task as any).user_id,
        task_id: taskId as any,
        period: currentPeriod,
        amount_cents: (task as any).failure_cost_cents,
        entry_type: "failure",
    });

    // @ts-ignore
    await (supabase.from("task_events") as any).insert({
        task_id: taskId as any,
        event_type: "VOUCHER_DENY",
        actor_id: (user as any).id,
        from_status: (task as any).status,
        to_status: "FAILED",
    });

    if ((task as any).user?.email) {
        await sendNotification({
            to: (task as any).user.email,
            userId: (task as any).user.id,
            subject: `Your task ${(task as any).title} has been denied`,
            title: "Task denied",
            text: `Your task ${(task as any).title} has been denied`,
            html: `
                <h1>Your task ${(task as any).title} has been denied</h1>
                <p>Hi ${(task as any).user.username || "there"},</p>
                <p>Your voucher denied <strong>${(task as any).title}</strong>.</p>
                <p>Failure cost was applied to your ledger.</p>
                <p><a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/tasks/${taskId}">Open task</a></p>
            `,
            url: `/dashboard/tasks/${taskId}`,
            tag: `task-denied-${taskId}`,
            data: { taskId, kind: "TASK_DENIED" },
        });
    }

    revalidatePath("/dashboard/voucher");
    revalidatePath(`/dashboard/tasks/${taskId}`);
    return { success: true };
}

export async function authorizeRectify(taskId: string) {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    // @ts-ignore
    const { data: task } = await (supabase.from("tasks") as any)
        .select("*")
        .eq("id", (taskId as any))
        .eq("voucher_id", (user as any).id)
        .single();

    if (!task) {
        return { error: "Task not found or you are not the voucher" };
    }

    if (!canTransition((task as any).status as TaskStatus, "RECTIFY")) {
        return { error: `Cannot rectify task in ${(task as any).status} status` };
    }

    // Check rectify pass usage
    const currentPeriod = new Date().toISOString().slice(0, 7);
    const { count } = await supabase
        .from("rectify_passes" as any)
        .select("*", { count: "exact", head: true })
        .eq("user_id", (task as any).user_id)
        .eq("period", currentPeriod);

    if ((count || 0) >= 5) {
        return { error: "User has already used all 5 rectify passes this month" };
    }

    // Update task
    const { error } = await (supabase.from("tasks") as any)
        .update({ status: "RECTIFIED" } as any)
        .eq("id", (taskId as any));

    if (error) {
        return { error: error.message };
    }

    // Create rectify pass record
    await (supabase.from("rectify_passes" as any) as any).insert({
        user_id: (task as any).user_id,
        task_id: (taskId as any),
        authorized_by: (user as any).id,
        period: currentPeriod,
    });

    // Create negative ledger entry to cancel out the failure
    await (supabase.from("ledger_entries" as any) as any).insert({
        user_id: (task as any).user_id,
        task_id: (taskId as any),
        period: currentPeriod,
        amount_cents: -(task as any).failure_cost_cents,
        entry_type: "rectified",
    });

    // @ts-ignore
    await (supabase.from("task_events") as any).insert({
        task_id: (taskId as any),
        event_type: "RECTIFY",
        actor_id: (user as any).id,
        from_status: "FAILED",
        to_status: "RECTIFIED",
    });

    revalidatePath("/dashboard/voucher");
    revalidatePath(`/dashboard/tasks/${taskId}`);
    return { success: true };
}

export async function getPendingVouchRequests() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return [];

    // @ts-ignore
    const { data: tasks } = await (supabase.from("tasks") as any)
        .select(`
      *,
      user:profiles!tasks_user_id_fkey(*)
    `)
        .eq("voucher_id", (user as any).id)
        .eq("status", "AWAITING_VOUCHER")
        .order("voucher_response_deadline", { ascending: true });

    const pendingTasks = (tasks as any[]) || [];
    if (pendingTasks.length === 0) return [];

    const taskIds = pendingTasks.map((task) => task.id);
    const ownerIds = [...new Set(pendingTasks.map((task) => task.user_id))];

    // Aggregate focused time per task for voucher visibility.
    // Use admin client because vouchers cannot read owners' pomo_sessions under RLS.
    const supabaseAdmin = createAdminClient();
    // @ts-ignore
    const { data: sessions } = await (supabaseAdmin.from("pomo_sessions") as any)
        .select("task_id, elapsed_seconds")
        .in("task_id", taskIds as any)
        .in("user_id", ownerIds as any)
        .neq("status", "DELETED");

    const secondsByTask = new Map<string, number>();
    for (const row of (sessions as any[]) || []) {
        const key = row.task_id as string;
        const total = secondsByTask.get(key) || 0;
        secondsByTask.set(key, total + (row.elapsed_seconds || 0));
    }

    return pendingTasks.map((task) => ({
        ...task,
        pomo_total_seconds: secondsByTask.get(task.id) || 0,
    }));
}

export async function getAssignedTasksForVoucher() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return [];

    // Include all non-final states; voucher can delete even active tasks
    const allowedStatuses = [
        "CREATED",
        "POSTPONED",
        "MARKED_COMPLETED",
        "AWAITING_VOUCHER",
    ];

    // @ts-ignore
    const { data: tasks } = await (supabase.from("tasks") as any)
        .select(`
      *,
      user:profiles!tasks_user_id_fkey(*)
    `)
        .eq("voucher_id", (user as any).id)
        .in("status", allowedStatuses)
        .order("deadline", { ascending: true });

    return (tasks as any) || [];
}

export async function getFailedTasks() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return [];

    const currentPeriod = new Date().toISOString().slice(0, 7);

    // Get failed tasks
    // @ts-ignore
    const { data: tasks } = await (supabase.from("tasks") as any)
        .select(`
      *,
      user:profiles!tasks_user_id_fkey(*)
    `)
        .eq("voucher_id", (user as any).id)
        .eq("status", "FAILED")
        .order("updated_at", { ascending: false });

    if (!tasks) return [];

    // Get pass counts for each owner
    const tasksWithCounts = await Promise.all(tasks.map(async (task: any) => {
        const { count } = await supabase
            .from("rectify_passes" as any)
            .select("*", { count: 'exact', head: true })
            .eq("user_id", task.user_id)
            .eq("period", currentPeriod);

        return { ...task, rectify_passes_used: count || 0 };
    }));

    return tasksWithCounts;
}

export async function getVouchHistory() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return [];

    const finalStatuses = ["COMPLETED", "FAILED", "RECTIFIED", "SETTLED", "DELETED"];

    const currentPeriod = new Date().toISOString().slice(0, 7);

    // @ts-ignore
    const { data: tasks } = await (supabase.from("tasks") as any)
        .select(`
      *,
      user:profiles!tasks_user_id_fkey(*)
    `)
        .eq("voucher_id", (user as any).id)
        .in("status", finalStatuses)
        .order("updated_at", { ascending: false });

    if (!tasks) return [];

    const tasksWithCounts = await Promise.all(tasks.map(async (task: any) => {
        const { count } = await supabase
            .from("rectify_passes" as any)
            .select("*", { count: 'exact', head: true })
            .eq("user_id", task.user_id)
            .eq("period", currentPeriod);

        return { ...task, rectify_passes_used: count || 0 };
    }));

    return tasksWithCounts;
}
