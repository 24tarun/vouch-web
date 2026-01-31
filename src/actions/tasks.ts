"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canTransition, type TaskStatus } from "@/lib/xstate/task-machine";
import { type Database } from "@/lib/types";
import { type SupabaseClient } from "@supabase/supabase-js";

export async function createTask(formData: FormData) {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const title = formData.get("title") as string;
    const description = formData.get("description") as string;
    const failureCostEuros = parseFloat(formData.get("failureCost") as string);
    const deadline = formData.get("deadline") as string;
    const voucherId = formData.get("voucherId") as string;

    if (!title || !deadline || !voucherId || isNaN(failureCostEuros)) {
        return { error: "Missing required fields" };
    }

    if (failureCostEuros < 0.01 || failureCostEuros > 100) {
        return { error: "Failure cost must be between €0.01 and €100" };
    }

    // Verify voucher is a friend
    // @ts-ignore
    const { data: friendship } = await supabase
        .from("friendships")
        .select("*")
        .eq("user_id", (user as any).id)
        .eq("friend_id", voucherId as any)
        .single();

    if (!friendship) {
        return { error: "You can only assign friends as vouchers" };
    }

    // @ts-ignore
    const { data: task, error } = await (supabase.from("tasks" as any) as any)
        .insert({
            user_id: (user as any).id,
            voucher_id: voucherId,
            title,
            description: description || null,
            failure_cost_cents: Math.round(failureCostEuros * 100),
            deadline: new Date(deadline).toISOString(),
            status: "CREATED",
        })
        .select()
        .single();

    if (error) {
        return { error: error.message };
    }

    // Log the creation event
    // @ts-ignore
    await supabase.from("task_events").insert({
        task_id: (task as any).id,
        event_type: "CREATED",
        actor_id: (user as any).id,
        from_status: "CREATED",
        to_status: "CREATED",
        metadata: { title, deadline, failure_cost_cents: Math.round(failureCostEuros * 100) },
    });

    revalidatePath("/dashboard");
    redirect(`/dashboard/tasks/${(task as any).id}`);
}

export async function activateTask(taskId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const { data: task } = await (supabase.from("tasks") as any)
        .select("*")
        .eq("id", (taskId as any))
        .eq("user_id", (user as any).id)
        .single();

    if (!task) {
        return { error: "Task not found" };
    }

    // Prevent activating after the deadline
    if (new Date() >= new Date((task as any).deadline)) {
        return { error: "Deadline has passed" };
    }

    if (!canTransition((task as any).status as TaskStatus, "ACTIVATE")) {
        return { error: `Cannot activate task in ${(task as any).status} status` };
    }

    // @ts-ignore
    const { error } = await (supabase.from("tasks") as any)
        .update({ status: "ACTIVE" } as any)
        .eq("id", (taskId as any));

    if (error) {
        return { error: error.message };
    }

    await (supabase.from("task_events") as any).insert({
        task_id: (taskId as any),
        event_type: "ACTIVATE",
        actor_id: (user as any).id,
        from_status: (task as any).status,
        to_status: "ACTIVE",
    });

    revalidatePath(`/dashboard/tasks/${taskId}`);
    return { success: true };
}

export async function markTaskComplete(taskId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const { data: task } = await (supabase.from("tasks") as any)
        .select("*")
        .eq("id", (taskId as any))
        .eq("user_id", (user as any).id)
        .single();

    if (!task) {
        return { error: "Task not found" };
    }

    if (!canTransition((task as any).status as TaskStatus, "MARK_COMPLETE")) {
        return { error: `Cannot mark complete from ${(task as any).status} status` };
    }

    // Check if before deadline
    if (new Date() >= new Date((task as any).deadline)) {
        return { error: "Deadline has passed" };
    }

    const voucherResponseDeadline = new Date();
    voucherResponseDeadline.setHours(voucherResponseDeadline.getHours() + 24);

    // @ts-ignore
    const { error } = await (supabase.from("tasks") as any)
        .update({
            status: "AWAITING_VOUCHER",
            marked_completed_at: new Date().toISOString(),
            voucher_response_deadline: voucherResponseDeadline.toISOString(),
        } as any)
        .eq("id", (taskId as any));

    if (error) {
        return { error: error.message };
    }

    await (supabase.from("task_events") as any).insert({
        task_id: (taskId as any),
        event_type: "MARK_COMPLETE",
        actor_id: (user as any).id,
        from_status: (task as any).status,
        to_status: "AWAITING_VOUCHER",
    });

    // TODO: Send email to voucher via Trigger.dev

    revalidatePath(`/dashboard/tasks/${taskId}`);
    return { success: true };
}

export async function postponeTask(taskId: string, newDeadline: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const { data: task } = await (supabase.from("tasks") as any)
        .select("*")
        .eq("id", (taskId as any))
        .eq("user_id", (user as any).id)
        .single();

    if (!task) {
        return { error: "Task not found" };
    }

    // Prevent postponing after the deadline
    if (new Date() >= new Date((task as any).deadline)) {
        return { error: "Deadline has passed" };
    }

    if (!canTransition((task as any).status as TaskStatus, "POSTPONE")) {
        return { error: `Cannot postpone task in ${(task as any).status} status` };
    }

    if ((task as any).postponed_at) {
        return { error: "Task has already been postponed once" };
    }

    // Validate new deadline is at most 1 hour from current deadline
    const currentDeadline = new Date((task as any).deadline);
    const newDeadlineDate = new Date(newDeadline);
    const maxDeadline = new Date(currentDeadline.getTime() + 60 * 60 * 1000);

    if (newDeadlineDate > maxDeadline) {
        return { error: "Can only postpone by up to 1 hour" };
    }

    // @ts-ignore
    const { error } = await (supabase.from("tasks") as any)
        .update({
            status: "POSTPONED",
            deadline: newDeadlineDate.toISOString(),
            postponed_at: new Date().toISOString(),
        } as any)
        .eq("id", (taskId as any));

    if (error) {
        return { error: error.message };
    }

    await (supabase.from("task_events") as any).insert({
        task_id: taskId as any,
        event_type: "POSTPONE",
        actor_id: (user as any).id,
        from_status: (task as any).status,
        to_status: "POSTPONED",
        metadata: { new_deadline: newDeadlineDate.toISOString() },
    });

    revalidatePath(`/dashboard/tasks/${taskId}`);
    return { success: true };
}

export async function getTask(taskId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    // @ts-ignore
    const { data: task } = await (supabase.from("tasks") as any)
        .select(`
      *,
      user:profiles!tasks_user_id_fkey(*),
      voucher:profiles!tasks_voucher_id_fkey(*)
    `)
        .eq("id", (taskId as any))
        .single();

    if (task) {
        const isOwner = (task as any).user_id === user.id;
        const isVoucher = (task as any).voucher_id === user.id;

        if (isOwner || isVoucher) {
            const now = new Date();
            const deadline = new Date((task as any).deadline);
            const shouldAutoFail = now >= deadline && ["ACTIVE", "POSTPONED", "CREATED"].includes((task as any).status);

            if (shouldAutoFail) {
                const currentPeriod = now.toISOString().slice(0, 7);

                await (supabase.from("tasks") as any)
                    .update({ status: "FAILED", updated_at: now.toISOString() } as any)
                    .eq("id", (taskId as any));

                await (supabase.from("ledger_entries") as any).insert({
                    user_id: (task as any).user_id,
                    task_id: (task as any).id,
                    period: currentPeriod,
                    amount_cents: (task as any).failure_cost_cents,
                    entry_type: "failure",
                });

                await (supabase.from("task_events") as any).insert({
                    task_id: (task as any).id,
                    event_type: "DEADLINE_MISSED",
                    actor_id: null,
                    from_status: (task as any).status,
                    to_status: "FAILED",
                    metadata: { reason: "Deadline passed without completion" },
                });

                (task as any).status = "FAILED";
                (task as any).updated_at = now.toISOString();

                revalidatePath(`/dashboard/tasks/${taskId}`);
            }
        }

        // Only return if user is owner or voucher
        if (isOwner || isVoucher) {
            return task;
        }
    }

    return null;
}

export async function getTaskEvents(taskId: string) {
    const supabase = await createClient();

    // @ts-ignore
    const { data: events } = await (supabase.from("task_events") as any)
        .select("*")
        .eq("task_id", (taskId as any))
        .order("created_at", { ascending: true });

    return (events as any) || [];
}
