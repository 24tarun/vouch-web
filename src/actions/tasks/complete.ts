"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canTransition, type TaskStatus } from "@/lib/xstate/task-machine";
import { deleteTaskProof } from "@/lib/task-proof";
import { type TaskProofIntent } from "@/lib/task-proof";
import { resolveWebUserClientInstanceId } from "@/lib/user-client-instance";
import { getTaskSubmissionWindowState } from "@/lib/task-submission-window";
import {
    revalidateTaskAndSocialSurfaces,
    validateProofIntent,
    RecurrenceRuleTable,
    INCOMPLETE_SUBTASKS_ERROR,
    INCOMPLETE_POMO_REQUIREMENT_ERROR,
    ACTIVE_POMO_RUNNING_ERROR,
    REQUIRED_PROOF_FOR_COMPLETION_ERROR,
    type MarkTaskCompleteWithProofResult,
} from "./helpers";
import { runOrchestratedTaskCommand, runTaskCommand } from "./command";

function buildBeforeStartSubmissionError(start: Date | null, end: Date | null): string {
    const fmt = (d: Date) =>
        d.toLocaleString(undefined, {
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        });
    const window = start && end ? ` between ${fmt(start)} and ${fmt(end)}` : "";
    return `This task can only be submitted${window}.`;
}

async function validateCompletionPreconditions(
    supabase: Awaited<ReturnType<typeof createClient>>,
    taskId: string,
    userId: string,
    task: any
): Promise<{ error?: string }> {
    const submissionWindow = getTaskSubmissionWindowState({
        startAtIso: task.start_at ?? null,
        deadlineIso: task.deadline,
        isStrict: Boolean(task.is_strict),
        now: new Date(),
    });

    if (submissionWindow.pastDeadline) return { error: "Deadline has passed" };
    if (submissionWindow.beforeStart) {
        return {
            error: buildBeforeStartSubmissionError(submissionWindow.startDate, submissionWindow.deadlineDate),
        };
    }

    const { count: incompleteSubtasksCount } = await (supabase.from("task_subtasks") as any)
        .select("id", { count: "exact", head: true })
        .eq("parent_task_id", taskId as any)
        .eq("user_id", userId as any)
        .eq("is_completed", false as any);

    if ((incompleteSubtasksCount || 0) > 0) return { error: INCOMPLETE_SUBTASKS_ERROR };

    const { data: pomoRows, error: pomoError } = await (supabase.from("pomo_sessions") as any)
        .select("elapsed_seconds, status")
        .eq("task_id", taskId as any)
        .eq("user_id", userId as any)
        .neq("status", "DELETED");

    if (pomoError) return { error: pomoError.message };

    const normalizedPomoRows = ((pomoRows as Array<{ elapsed_seconds: number; status: string }> | null) || []);
    if (normalizedPomoRows.some((row) => row.status === "ACTIVE")) {
        return { error: ACTIVE_POMO_RUNNING_ERROR };
    }

    const requiredPomoMinutes = Number(task.required_pomo_minutes || 0);
    if (Number.isInteger(requiredPomoMinutes) && requiredPomoMinutes > 0) {
        const totalPomoSeconds = normalizedPomoRows.reduce((sum, row) => sum + (row.elapsed_seconds || 0), 0);
        const requiredPomoSeconds = requiredPomoMinutes * 60;
        if (totalPomoSeconds < requiredPomoSeconds) {
            const remainingSeconds = requiredPomoSeconds - totalPomoSeconds;
            const remainingMinutes = Math.ceil(remainingSeconds / 60);
            return {
                error: `${INCOMPLETE_POMO_REQUIREMENT_ERROR} ${remainingMinutes} more minute${remainingMinutes === 1 ? "" : "s"} needed (${Math.floor(totalPomoSeconds / 60)}/${requiredPomoMinutes}m).`,
            };
        }
    }

    return {};
}

export async function cancelRepetition(taskId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return { error: "Not authenticated" };

    // @ts-ignore
    const { data: task } = await supabase.from("tasks")
        .select("recurrence_rule_id, status")
        .eq("id", taskId)
        .eq("user_id", user.id)
        .single();

    if (!task || !(task as any).recurrence_rule_id) {
        return { error: "Task is not repetitive" };
    }

    const ruleId = (task as any).recurrence_rule_id;

    const { data: linkedCommitments } = await (supabase.from("commitment_task_links") as any)
        .select("commitment_id, commitments!inner(name, status)")
        .eq("recurrence_rule_id", ruleId as any)
        .in("commitments.status", ["DRAFT", "ACTIVE"] as any);

    if (((linkedCommitments as any[]) || []).length > 0) {
        const first = (linkedCommitments as any[])[0];
        const name = String(first?.commitments?.name || "this commitment");
        return {
            error: `This recurring task is part of the commitment '${name}'. Delete that commitment first.`,
        };
    }

    // @ts-ignore
    const { error } = await (supabase.from(RecurrenceRuleTable) as any)
        .delete()
        .eq("id", ruleId)
        .eq("user_id", user.id);

    if (error) return { error: error.message };

    const { error: eventError } = await (supabase.from("task_events") as any).insert({
        task_id: taskId,
        event_type: "REPETITION_STOPPED",
        actor_id: user.id,
        actor_user_client_instance_id: await resolveWebUserClientInstanceId(user.id),
        from_status: (task as any).status,
        to_status: (task as any).status,
    });

    if (eventError) {
        console.error("Failed to log REPETITION_STOPPED event:", eventError);
    }

    revalidatePath("/tasks");
    revalidatePath(`/tasks/${taskId}`);
    return { success: true };
}

export async function setRecurrencePaused(taskId: string, paused: boolean) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return { error: "Not authenticated" };

    const actorUserClientInstanceId = await resolveWebUserClientInstanceId(user.id);
    type SetRecurrencePausedRpc = (
        functionName: "set_recurrence_paused",
        args: {
            p_task_id: string;
            p_paused: boolean;
            p_actor_user_client_instance_id: string | null;
        }
    ) => Promise<{
        data: Array<{
            recurrence_rule_id: string;
            paused_at: string | null;
            state_changed: boolean;
        }> | null;
        error: { message: string } | null;
    }>;
    const callSetRecurrencePaused = supabase.rpc.bind(supabase) as unknown as SetRecurrencePausedRpc;
    const { data, error } = await callSetRecurrencePaused("set_recurrence_paused", {
        p_task_id: taskId,
        p_paused: paused,
        p_actor_user_client_instance_id: actorUserClientInstanceId,
    });

    if (error) return { error: error.message };

    const result = Array.isArray(data) ? data[0] : data;
    revalidatePath("/tasks");
    revalidatePath("/settings");
    revalidatePath(`/tasks/${taskId}`);

    return {
        success: true,
        recurrenceRuleId: result?.recurrence_rule_id as string | undefined,
        pausedAt: (result?.paused_at as string | null | undefined) ?? null,
        stateChanged: Boolean(result?.state_changed),
    };
}

export async function markTaskComplete(taskId: string, userTimeZone?: string) {
    return markTaskCompleteWithProofIntent(taskId, userTimeZone);
}

export async function markTaskCompleteWithProofIntent(
    taskId: string,
    userTimeZone?: string,
    rawProofIntent?: TaskProofIntent | null
): Promise<MarkTaskCompleteWithProofResult> {
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

    const preconditionResult = await validateCompletionPreconditions(
        supabase,
        taskId,
        (user as any).id,
        task
    );
    if (preconditionResult.error) return { error: preconditionResult.error };

    const isSelfVouched = (task as any).voucher_id === (user as any).id;
    const requiresProofForCompletion =
        Boolean((task as any).requires_proof) &&
        !isSelfVouched;
    const proofValidation = validateProofIntent(rawProofIntent);
    if (proofValidation.error) {
        return { error: proofValidation.error };
    }

    const proofIntent = proofValidation.proofIntent;
    if (proofIntent && !isSelfVouched) {
        const { initAwaitingVoucherProofUpload } = await import("./proof");
        return initAwaitingVoucherProofUpload(taskId, proofIntent);
    }

    const { data: existingUploadedProofRows, error: existingUploadedProofError } = await (supabase.from("task_completion_proofs") as any)
        .select("id")
        .eq("task_id", taskId as any)
        .eq("owner_id", user.id as any)
        .eq("upload_state", "UPLOADED")
        .not("object_path", "is", null)
        .limit(1);

    if (existingUploadedProofError) {
        return { error: existingUploadedProofError.message };
    }

    const hasExistingUploadedProof = Boolean(existingUploadedProofRows && existingUploadedProofRows.length > 0);
    if (requiresProofForCompletion && !proofIntent && !hasExistingUploadedProof) {
        return { error: REQUIRED_PROOF_FOR_COMPLETION_ERROR };
    }

    const command = await runOrchestratedTaskCommand(supabase as any, {
        action: "complete-task-command",
        taskId,
        clientActionAt: new Date().toISOString(),
        actorUserClientInstanceId: await resolveWebUserClientInstanceId(user.id),
    });
    if (!command.success) return { error: command.message };

    if (isSelfVouched || !hasExistingUploadedProof) {
        const cleanup = await deleteTaskProof(taskId, "complete_task_post_commit");
        if (!cleanup.success) console.error(`Post-commit proof cleanup failed for task ${taskId}:`, cleanup.error);
    }

    revalidateTaskAndSocialSurfaces(taskId, (user as any).id, (task as any).voucher_id);
    return { success: true };
}

export async function undoTaskComplete(taskId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const { data: task } = await (supabase.from("tasks") as any)
        .select("id, status, deadline, postponed_at, voucher_id")
        .eq("id", taskId as any)
        .eq("user_id", user.id as any)
        .single();

    if (!task) {
        return { error: "Task not found" };
    }

    const command = await runTaskCommand(supabase as any, "undo_task_completion_v2", {
        p_task_id: taskId,
        p_actor_user_client_instance_id: await resolveWebUserClientInstanceId(user.id),
    });
    if (!command.success) return { error: command.message };
    const restoredStatus = command.toStatus as "ACTIVE" | "POSTPONED";

    const cleanup = await deleteTaskProof(taskId, "undo_complete_post_commit");
    if (!cleanup.success) console.error(`Post-commit proof cleanup failed for task ${taskId}:`, cleanup.error);

    revalidateTaskAndSocialSurfaces(taskId, user.id, (task as any).voucher_id);

    return { success: true, status: restoredStatus };
}

export async function overrideTask(taskId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const command = await runTaskCommand(supabase as any, "override_task_v2", {
        p_task_id: taskId,
        p_actor_user_client_instance_id: await resolveWebUserClientInstanceId(user.id),
    });
    if (!command.success) return { error: command.message };

    revalidatePath(`/tasks/${taskId}`);
    revalidatePath("/tasks");
    return { success: true };
}
