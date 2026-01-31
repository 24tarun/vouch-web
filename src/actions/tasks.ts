"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canTransition, type TaskStatus } from "@/lib/xstate/task-machine";

export async function createTask(formData: FormData) {
    const supabase = await createClient();
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
    const { data: friendship } = await supabase
        .from("friendships")
        .select("*")
        .eq("user_id", user.id)
        .eq("friend_id", voucherId)
        .single();

    if (!friendship) {
        return { error: "You can only assign friends as vouchers" };
    }

    const { data: task, error } = await supabase
        .from("tasks")
        .insert({
            user_id: user.id,
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
    await supabase.from("task_events").insert({
        task_id: task.id,
        event_type: "CREATED",
        actor_id: user.id,
        from_status: "CREATED",
        to_status: "CREATED",
        metadata: { title, deadline, failure_cost_cents: Math.round(failureCostEuros * 100) },
    });

    revalidatePath("/dashboard");
    redirect(`/dashboard/tasks/${task.id}`);
}

export async function activateTask(taskId: string) {
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
        .eq("user_id", user.id)
        .single();

    if (!task) {
        return { error: "Task not found" };
    }

    if (!canTransition(task.status as TaskStatus, "ACTIVATE")) {
        return { error: `Cannot activate task in ${task.status} status` };
    }

    const { error } = await supabase
        .from("tasks")
        .update({ status: "ACTIVE" })
        .eq("id", taskId);

    if (error) {
        return { error: error.message };
    }

    await supabase.from("task_events").insert({
        task_id: taskId,
        event_type: "ACTIVATE",
        actor_id: user.id,
        from_status: task.status,
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

    const { data: task } = await supabase
        .from("tasks")
        .select("*")
        .eq("id", taskId)
        .eq("user_id", user.id)
        .single();

    if (!task) {
        return { error: "Task not found" };
    }

    if (!canTransition(task.status as TaskStatus, "MARK_COMPLETE")) {
        return { error: `Cannot mark complete from ${task.status} status` };
    }

    // Check if before deadline
    if (new Date() >= new Date(task.deadline)) {
        return { error: "Deadline has passed" };
    }

    const voucherResponseDeadline = new Date();
    voucherResponseDeadline.setHours(voucherResponseDeadline.getHours() + 24);

    const { error } = await supabase
        .from("tasks")
        .update({
            status: "AWAITING_VOUCHER",
            marked_completed_at: new Date().toISOString(),
            voucher_response_deadline: voucherResponseDeadline.toISOString(),
        })
        .eq("id", taskId);

    if (error) {
        return { error: error.message };
    }

    await supabase.from("task_events").insert({
        task_id: taskId,
        event_type: "MARK_COMPLETE",
        actor_id: user.id,
        from_status: task.status,
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

    const { data: task } = await supabase
        .from("tasks")
        .select("*")
        .eq("id", taskId)
        .eq("user_id", user.id)
        .single();

    if (!task) {
        return { error: "Task not found" };
    }

    if (!canTransition(task.status as TaskStatus, "POSTPONE")) {
        return { error: `Cannot postpone task in ${task.status} status` };
    }

    if (task.postponed_at) {
        return { error: "Task has already been postponed once" };
    }

    // Validate new deadline is at most 1 hour from current deadline
    const currentDeadline = new Date(task.deadline);
    const newDeadlineDate = new Date(newDeadline);
    const maxDeadline = new Date(currentDeadline.getTime() + 60 * 60 * 1000);

    if (newDeadlineDate > maxDeadline) {
        return { error: "Can only postpone by up to 1 hour" };
    }

    const { error } = await supabase
        .from("tasks")
        .update({
            status: "POSTPONED",
            deadline: newDeadlineDate.toISOString(),
            postponed_at: new Date().toISOString(),
        })
        .eq("id", taskId);

    if (error) {
        return { error: error.message };
    }

    await supabase.from("task_events").insert({
        task_id: taskId,
        event_type: "POSTPONE",
        actor_id: user.id,
        from_status: task.status,
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

    const { data: task } = await supabase
        .from("tasks")
        .select(`
      *,
      user:profiles!tasks_user_id_fkey(*),
      voucher:profiles!tasks_voucher_id_fkey(*)
    `)
        .eq("id", taskId)
        .single();

    // Only return if user is owner or voucher
    if (task && (task.user_id === user.id || task.voucher_id === user.id)) {
        return task;
    }

    return null;
}

export async function getTaskEvents(taskId: string) {
    const supabase = await createClient();

    const { data: events } = await supabase
        .from("task_events")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: true });

    return events || [];
}
