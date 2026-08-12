"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { type TaskStatus } from "@/lib/xstate/task-machine";
import { isOwnerTempDeletableStatus, getOwnerDeleteRemainingMs } from "@/lib/task-delete-window";
import { resolveWebUserClientInstanceId } from "@/lib/user-client-instance";
import { notifyCommitmentFailureIfNeeded } from "@/actions/commitments";
import { runTaskCommand } from "./command";
import {
    invalidateActiveTasksCache,
    invalidatePendingVoucherRequestsCache,
    revalidateTaskSurfaces,
    parseAndValidateFutureDeadline,
    INVALID_DEADLINE_ERROR,
} from "./helpers";

export async function postponeTask(taskId: string, newDeadlineIso: string) {
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

    if (typeof newDeadlineIso !== "string" || !newDeadlineIso.trim()) {
        return { error: INVALID_DEADLINE_ERROR };
    }

    const deadlineValidation = parseAndValidateFutureDeadline(newDeadlineIso);
    if (!deadlineValidation.deadline) {
        return { error: deadlineValidation.error || INVALID_DEADLINE_ERROR };
    }
    const newDeadlineDate = deadlineValidation.deadline;

    const command = await runTaskCommand(supabase as any, "postpone_task_v2", {
        p_task_id: taskId,
        p_new_deadline: newDeadlineDate.toISOString(),
        p_actor_user_client_instance_id: await resolveWebUserClientInstanceId(user.id),
    });
    if (!command.success) return { error: command.message };

    invalidatePendingVoucherRequestsCache((task as any).voucher_id);
    revalidatePath("/friends");
    revalidateTaskSurfaces(taskId, user.id);
    return { success: true };
}

export async function ownerTempDeleteTask(taskId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const { data: task } = await (supabase.from("tasks") as any)
        .select("id, user_id, voucher_id, status, created_at, recurrence_rule_id")
        .eq("id", taskId as any)
        .eq("user_id", user.id as any)
        .single();

    if (!task) {
        return { error: "Task not found" };
    }

    if ((task as any).recurrence_rule_id) {
        return { error: "Recurring task instances cannot be deleted. Pause or stop the repetition instead." };
    }

    const { data: linkedLinks } = await (supabase.from("commitment_task_links") as any)
        .select("id, commitment_id, commitments!inner(name, status)")
        .eq("task_id", taskId as any);

    if (((linkedLinks as any[]) || []).length > 0) {
        for (const link of ((linkedLinks as any[]) || [])) {
            if (link?.commitments?.status === "ACTIVE") {
                return {
                    error: `This task is part of the active commitment '${link.commitments.name}'. Delete that commitment first.`,
                };
            }
        }

        const draftLinkIds = ((linkedLinks as any[]) || [])
            .filter((link) => link?.commitments?.status === "DRAFT" && link?.id)
            .map((link) => link.id);

        if (draftLinkIds.length > 0) {
            await (supabase.from("commitment_task_links") as any)
                .delete()
                .in("id", draftLinkIds as any);
        }
    }

    if (!isOwnerTempDeletableStatus(task.status as TaskStatus)) {
        return { error: `Cannot delete task in ${(task as any).status} status` };
    }

    if (getOwnerDeleteRemainingMs((task as any).created_at) <= 0) {
        return { error: "Delete window expired. Tasks can only be deleted within 1 hour." };
    }

    const command = await runTaskCommand(supabase as any, "delete_task_v2", {
        p_task_id: taskId,
        p_actor_user_client_instance_id: await resolveWebUserClientInstanceId(user.id),
    });
    if (!command.success) return { error: command.message };

    invalidateActiveTasksCache(user.id);
    invalidatePendingVoucherRequestsCache((task as any).voucher_id);
    revalidatePath("/tasks");
    revalidatePath("/friends");
    revalidatePath("/settings");
    revalidatePath(`/tasks/${taskId}`);
    return { success: true };
}

export async function surrenderTask(taskId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const actorUserClientInstanceId = await resolveWebUserClientInstanceId(user.id);
    const command = await runTaskCommand(supabase as any, "surrender_task_v2", {
        p_task_id: taskId,
        p_actor_user_client_instance_id: actorUserClientInstanceId,
    });
    if (!command.success || !command.task) return { error: command.success ? "Task could not be surrendered" : command.message };
    const data = command.task as any;

    await notifyCommitmentFailureIfNeeded(taskId, data.recurrence_rule_id ?? null);

    invalidateActiveTasksCache(user.id);
    invalidatePendingVoucherRequestsCache(data.voucher_id);
    revalidatePath("/tasks");
    revalidatePath("/friends");
    revalidatePath("/settings");
    revalidatePath("/ledger");
    revalidatePath(`/tasks/${taskId}`);

    return {
        success: true,
        task: {
            id: data.id as string,
            status: "SURRENDERED" as const,
        },
    };
}
