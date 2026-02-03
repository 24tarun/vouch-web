"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canTransition, type TaskStatus } from "@/lib/xstate/task-machine";
import { type Database } from "@/lib/types";
import { type SupabaseClient } from "@supabase/supabase-js";
import { sendNotification } from "@/lib/notifications";

// Wrapper for simple task creation (inline)
export async function createTaskSimple(title: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return { error: "Not authenticated" };

    // Default configuration for simple tasks
    // Auto-assign first friend as voucher for now
    // @ts-ignore
    const { data: friends } = await supabase
        .from("friendships")
        .select("friend_id") // changed to select friend_id
        .eq("user_id", user.id)
        .limit(1);

    const defaultVoucherId = (friends as any)?.[0]?.friend_id;

    if (!defaultVoucherId) {
        throw new Error("You need at least one friend to create a task.");
    }

    // Default params: Deadline = End of today
    const deadline = new Date();
    deadline.setHours(23, 59, 0, 0);

    // @ts-ignore
    const { data: task, error } = await (supabase.from("tasks") as any)
        .insert({
            user_id: user.id,
            voucher_id: defaultVoucherId,
            title,
            description: null,
            failure_cost_cents: 10, // Default 0.10 EUR
            deadline: deadline.toISOString(),
            status: "CREATED",
        })
        .select()
        .single();

    if (error) throw new Error(error.message);

    // Event
    // @ts-ignore
    await supabase.from("task_events").insert({
        task_id: (task as any).id,
        event_type: "CREATED",
        actor_id: user.id,
        from_status: "CREATED",
        to_status: "CREATED",
        metadata: { title, type: "simple" },
    });

    revalidatePath("/dashboard");
    return { success: true, taskId: (task as any).id };
}

export const markTaskCompleted = markTaskComplete; // Alias for component compatibility

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
    return { success: true, taskId: (task as any).id };
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
        .select("*, voucher:profiles!tasks_voucher_id_fkey(email, username), user:profiles!tasks_user_id_fkey(username)")
        .eq("id", (taskId as any))
        .eq("user_id", (user as any).id)
        .single();

    if (!task) {
        return { error: "Task not found" };
    }

    // if (!canTransition((task as any).status as TaskStatus, "MARK_COMPLETE")) {
    //     return { error: `Cannot mark complete from ${(task as any).status} status` };
    // }

    // if (new Date() >= new Date((task as any).deadline)) {
    //     return { error: "Deadline has passed" };
    // }

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

    // Notify the voucher (Tandem Email + Push)
    if ((task as any).voucher?.email) {
        await sendNotification({
            to: (task as any).voucher.email,
            userId: (task as any).voucher.id, // Enable push
            subject: `Review Request: ${(task as any).title}`,
            title: "Task Review Request",
            html: `
          <h1>Task Completed!</h1>
          <p>Hi ${(task as any).voucher.username},</p>
          <p><strong>${(task as any).user?.username || "The user"}</strong> has marked their task <strong>"${(task as any).title}"</strong> as complete.</p>
          <p>Please review and verify it before the deadline: <strong>${voucherResponseDeadline.toLocaleString()}</strong></p>
          <br/>
          <a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/voucher">Review Task</a>
        `,
        });
    }

    revalidatePath(`/dashboard/tasks/${taskId}`);
    return { success: true };
}

export async function postponeTask(taskId: string, newDeadline?: string) {
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

    const currentDeadline = new Date((task as any).deadline);
    let newDeadlineDate = newDeadline ? new Date(newDeadline) : new Date(currentDeadline.getTime() + 60 * 60 * 1000);

    /*
    if (new Date() >= new Date((task as any).deadline)) {
        return { error: "Deadline has passed" };
    }
    if (!canTransition((task as any).status as TaskStatus, "POSTPONE")) {
        return { error: `Cannot postpone task in ${(task as any).status} status` };
    }
    if ((task as any).postponed_at) {
        return { error: "Task has already been postponed once" };
    }
    */

    if (["AWAITING_VOUCHER", "MARKED_COMPLETED", "COMPLETED", "FAILED", "RECTIFIED", "SETTLED", "DELETED"].includes((task as any).status)) {
        return { error: `Cannot postpone task in ${(task as any).status} status` };
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

export async function forceMajeureTask(taskId: string) {
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

    if ((task as any).status !== "FAILED") {
        return { error: "Force Majeure can only be used on tasks that have failed or been denied." };
    }

    // Check force majeure usage (max 1 per month)
    const now = new Date();
    const currentPeriod = now.toISOString().slice(0, 7);

    const { count } = await supabase
        .from("force_majeure" as any)
        .select("*", { count: 'exact', head: true })
        .eq("user_id", user.id)
        .eq("period", currentPeriod);

    if ((count || 0) >= 1) {
        return { error: "You have already used your force majeure for this month" };
    }

    // Update status to SETTLED
    const { error } = await (supabase.from("tasks") as any)
        .update({ status: "SETTLED", updated_at: now.toISOString() } as any)
        .eq("id", (taskId as any));

    if (error) {
        return { error: error.message };
    }

    // Create force majeure record
    await (supabase.from("force_majeure" as any) as any).insert({
        user_id: user.id,
        task_id: taskId as any,
        period: currentPeriod,
    });

    // Create negative ledger entry to cancel out the failure
    await (supabase.from("ledger_entries" as any) as any).insert({
        user_id: user.id,
        task_id: taskId as any,
        period: currentPeriod,
        amount_cents: -(task as any).failure_cost_cents,
        entry_type: "force_majeure",
    });

    // Log event
    await (supabase.from("task_events") as any).insert({
        task_id: taskId as any,
        event_type: "FORCE_MAJEURE",
        actor_id: user.id,
        from_status: (task as any).status,
        to_status: "SETTLED",
    });

    revalidatePath(`/dashboard/tasks/${taskId}`);
    revalidatePath("/dashboard");
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
            const shouldAutoFail = now >= deadline && ["CREATED", "POSTPONED"].includes((task as any).status);

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
