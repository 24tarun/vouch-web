"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canTransition, type TaskStatus } from "@/lib/xstate/task-machine";
import { type Database } from "@/lib/types";
import { type SupabaseClient } from "@supabase/supabase-js";

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
        .select("*")
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
        .select("*")
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

    return (tasks as any) || [];
}

export async function getFailedTasks() {
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
        .eq("status", "FAILED")
        .order("updated_at", { ascending: false });

    return (tasks as any) || [];
}
