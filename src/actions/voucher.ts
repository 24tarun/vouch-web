"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canTransition, type TaskStatus } from "@/lib/xstate/task-machine";

export async function voucherAccept(taskId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const { data: task } = await supabase
        .from("tasks")
        .select("*")
        .eq("id", taskId)
        .eq("voucher_id", user.id)
        .single();

    if (!task) {
        return { error: "Task not found or you are not the voucher" };
    }

    if (!canTransition(task.status as TaskStatus, "VOUCHER_ACCEPT")) {
        return { error: `Cannot accept task in ${task.status} status` };
    }

    const { error } = await supabase
        .from("tasks")
        .update({ status: "COMPLETED" })
        .eq("id", taskId);

    if (error) {
        return { error: error.message };
    }

    await supabase.from("task_events").insert({
        task_id: taskId,
        event_type: "VOUCHER_ACCEPT",
        actor_id: user.id,
        from_status: task.status,
        to_status: "COMPLETED",
    });

    revalidatePath("/dashboard/voucher");
    revalidatePath(`/dashboard/tasks/${taskId}`);
    return { success: true };
}

export async function voucherDeny(taskId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const { data: task } = await supabase
        .from("tasks")
        .select("*")
        .eq("id", taskId)
        .eq("voucher_id", user.id)
        .single();

    if (!task) {
        return { error: "Task not found or you are not the voucher" };
    }

    if (!canTransition(task.status as TaskStatus, "VOUCHER_DENY")) {
        return { error: `Cannot deny task in ${task.status} status` };
    }

    // Add to ledger
    const currentPeriod = new Date().toISOString().slice(0, 7);

    const { error } = await supabase
        .from("tasks")
        .update({ status: "FAILED" })
        .eq("id", taskId);

    if (error) {
        return { error: error.message };
    }

    // Create ledger entry
    await supabase.from("ledger_entries").insert({
        user_id: task.user_id,
        task_id: taskId,
        period: currentPeriod,
        amount_cents: task.failure_cost_cents,
        entry_type: "failure",
    });

    await supabase.from("task_events").insert({
        task_id: taskId,
        event_type: "VOUCHER_DENY",
        actor_id: user.id,
        from_status: task.status,
        to_status: "FAILED",
    });

    revalidatePath("/dashboard/voucher");
    revalidatePath(`/dashboard/tasks/${taskId}`);
    return { success: true };
}

export async function authorizeRectify(taskId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const { data: task } = await supabase
        .from("tasks")
        .select("*")
        .eq("id", taskId)
        .eq("voucher_id", user.id)
        .single();

    if (!task) {
        return { error: "Task not found or you are not the voucher" };
    }

    if (!canTransition(task.status as TaskStatus, "RECTIFY")) {
        return { error: `Cannot rectify task in ${task.status} status` };
    }

    // Check rectify pass usage
    const currentPeriod = new Date().toISOString().slice(0, 7);
    const { count } = await supabase
        .from("rectify_passes")
        .select("*", { count: "exact", head: true })
        .eq("user_id", task.user_id)
        .eq("period", currentPeriod);

    if ((count || 0) >= 5) {
        return { error: "User has already used all 5 rectify passes this month" };
    }

    // Update task
    const { error } = await supabase
        .from("tasks")
        .update({ status: "RECTIFIED" })
        .eq("id", taskId);

    if (error) {
        return { error: error.message };
    }

    // Create rectify pass record
    await supabase.from("rectify_passes").insert({
        user_id: task.user_id,
        task_id: taskId,
        authorized_by: user.id,
        period: currentPeriod,
    });

    // Create negative ledger entry to cancel out the failure
    await supabase.from("ledger_entries").insert({
        user_id: task.user_id,
        task_id: taskId,
        period: currentPeriod,
        amount_cents: -task.failure_cost_cents,
        entry_type: "rectified",
    });

    await supabase.from("task_events").insert({
        task_id: taskId,
        event_type: "RECTIFY",
        actor_id: user.id,
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

    const { data: tasks } = await supabase
        .from("tasks")
        .select(`
      *,
      user:profiles!tasks_user_id_fkey(*)
    `)
        .eq("voucher_id", user.id)
        .eq("status", "AWAITING_VOUCHER")
        .order("voucher_response_deadline", { ascending: true });

    return tasks || [];
}

export async function getFailedTasks() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return [];

    const { data: tasks } = await supabase
        .from("tasks")
        .select(`
      *,
      user:profiles!tasks_user_id_fkey(*)
    `)
        .eq("voucher_id", user.id)
        .eq("status", "FAILED")
        .order("updated_at", { ascending: false });

    return tasks || [];
}
