"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canTransition, type TaskStatus } from "@/lib/xstate/task-machine";
import { deleteTaskProof, TASK_PROOFS_BUCKET, buildTaskProofObjectPath } from "@/lib/task-proof";
import { type TaskProofIntent } from "@/lib/task-proof";
import {
    getAwaitingProofReviewStatus,
    canFinalizeOrRevertProof,
} from "@/lib/task-proof-routing";
import { resolveWebUserClientInstanceId } from "@/lib/user-client-instance";
import { normalizeProofTimestampText } from "@/lib/proof-timestamp";
import {
    getTaskSubmissionWindowState,
} from "@/lib/task-submission-window";
import { SYSTEM_ACTOR_PROFILE_ID } from "@/lib/system-actor";
import {
    invalidateActiveTasksCache,
    invalidatePendingVoucherRequestsCache,
    enqueueGoogleCalendarUpsert,
    validateProofIntent,
    getVoucherResponseDeadlineUtc,
    RecurrenceRuleTable,
    INCOMPLETE_SUBTASKS_ERROR,
    INCOMPLETE_POMO_REQUIREMENT_ERROR,
    ACTIVE_POMO_RUNNING_ERROR,
    REQUIRED_PROOF_FOR_COMPLETION_ERROR,
    INVALID_TASK_PROOF_ERROR,
    type MarkTaskCompleteWithProofResult,
} from "./helpers";

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

    const submissionWindow = getTaskSubmissionWindowState({
        startAtIso: (task as any).start_at ?? null,
        deadlineIso: (task as any).deadline,
        isStrict: Boolean((task as any).is_strict),
        now: new Date(),
    });

    if (submissionWindow.pastDeadline) {
        return { error: "Deadline has passed" };
    }

    if (submissionWindow.beforeStart) {
        const start = submissionWindow.startDate;
        const end = submissionWindow.deadlineDate;
        const fmt = (d: Date) => d.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
        const window = start && end ? ` between ${fmt(start)} and ${fmt(end)}` : "";
        return { error: `This task can only be submitted${window}.` };
    }

    const { count: incompleteSubtasksCount } = await (supabase.from("task_subtasks") as any)
        .select("id", { count: "exact", head: true })
        .eq("parent_task_id", taskId as any)
        .eq("user_id", (user as any).id as any)
        .eq("is_completed", false as any);

    if ((incompleteSubtasksCount || 0) > 0) {
        return { error: INCOMPLETE_SUBTASKS_ERROR };
    }

    const { data: pomoRows, error: pomoError } = await (supabase.from("pomo_sessions") as any)
        .select("elapsed_seconds, status")
        .eq("task_id", taskId as any)
        .eq("user_id", (user as any).id as any)
        .neq("status", "DELETED");

    if (pomoError) {
        return { error: pomoError.message };
    }

    const normalizedPomoRows = ((pomoRows as Array<{ elapsed_seconds: number; status: string }> | null) || []);
    const hasRunningPomoForTask = normalizedPomoRows.some((row) => row.status === "ACTIVE");
    if (hasRunningPomoForTask) {
        return { error: ACTIVE_POMO_RUNNING_ERROR };
    }

    const requiredPomoMinutes = Number((task as any).required_pomo_minutes || 0);
    if (Number.isInteger(requiredPomoMinutes) && requiredPomoMinutes > 0) {
        const totalPomoSeconds = normalizedPomoRows
            .reduce((sum, row) => sum + (row.elapsed_seconds || 0), 0);
        const requiredPomoSeconds = requiredPomoMinutes * 60;

        if (totalPomoSeconds < requiredPomoSeconds) {
            const remainingSeconds = requiredPomoSeconds - totalPomoSeconds;
            const remainingMinutes = Math.ceil(remainingSeconds / 60);
            return {
                error: `${INCOMPLETE_POMO_REQUIREMENT_ERROR} ${remainingMinutes} more minute${remainingMinutes === 1 ? "" : "s"} needed (${Math.floor(totalPomoSeconds / 60)}/${requiredPomoMinutes}m).`,
            };
        }
    }

    const isSelfVouched = (task as any).voucher_id === (user as any).id;
    const requiresProofForCompletion =
        Boolean((task as any).requires_proof) &&
        !isSelfVouched;
    const nowIso = new Date().toISOString();

    if (isSelfVouched) {
        const cleanup = await deleteTaskProof(taskId, "self_vouch_auto_accept");
        if (!cleanup.success) {
            return { error: cleanup.error || "Could not clear previous proof media." };
        }

        const { data: updatedRows, error: updateError } = await (supabase.from("tasks") as any)
            .update({
                status: "ACCEPTED",
                marked_completed_at: nowIso,
                voucher_response_deadline: null,
                proof_request_open: false,
                proof_requested_at: null,
                proof_requested_by: null,
                updated_at: nowIso,
            } as any)
            .eq("id", taskId as any)
            .eq("user_id", (user as any).id)
            .in("status", ["ACTIVE", "POSTPONED"] as any)
            .gt("deadline", nowIso)
            .select("id");

        if (updateError) {
            return { error: updateError.message };
        }

        if (!updatedRows || updatedRows.length === 0) {
            return { error: "Task can no longer be marked complete. Please refresh." };
        }

        await (supabase.from("task_events") as any).insert({
            task_id: taskId as any,
            event_type: "MARK_COMPLETE",
            actor_id: (user as any).id,
            actor_user_client_instance_id: await resolveWebUserClientInstanceId(user.id),
            from_status: (task as any).status,
            to_status: "ACCEPTED",
            metadata: {
                self_vouched: true,
                auto_accepted: true,
            },
        });

        invalidateActiveTasksCache((user as any).id);
        invalidatePendingVoucherRequestsCache((task as any).voucher_id);
        await enqueueGoogleCalendarUpsert((user as any).id, taskId);
        revalidatePath("/tasks");
        revalidatePath("/stats");
        revalidatePath("/friends");
        revalidatePath(`/tasks/${taskId}`);
        return { success: true };
    }

    const proofValidation = validateProofIntent(rawProofIntent);
    if (proofValidation.error) {
        return { error: proofValidation.error };
    }

    const proofIntent = proofValidation.proofIntent;
    if (requiresProofForCompletion && !proofIntent) {
        return { error: REQUIRED_PROOF_FOR_COMPLETION_ERROR };
    }

    const completionStatus = getAwaitingProofReviewStatus((task as any).voucher_id);
    const isAiVoucher = completionStatus === "AWAITING_AI";
    const voucherResponseDeadline = isAiVoucher ? null : getVoucherResponseDeadlineUtc(new Date(), userTimeZone);

    // @ts-ignore
    const { data: updatedRows, error } = await (supabase.from("tasks") as any)
        .update({
            status: completionStatus,
            marked_completed_at: nowIso,
            voucher_response_deadline: voucherResponseDeadline ? voucherResponseDeadline.toISOString() : null,
            proof_request_open: false,
            proof_requested_at: null,
            proof_requested_by: null,
            updated_at: nowIso,
        } as any)
        .eq("id", (taskId as any))
        .eq("user_id", (user as any).id)
        .in("status", ["ACTIVE", "POSTPONED"] as any)
        .gt("deadline", nowIso)
        .select("id");

    if (error) {
        return { error: error.message };
    }

    if (!updatedRows || updatedRows.length === 0) {
        return { error: "Task can no longer be marked complete. Please refresh." };
    }

    let proofUploadTarget: { bucket: string; objectPath: string; uploadToken?: string } | undefined;

    if (proofIntent) {
        const objectPath = buildTaskProofObjectPath({
            ownerId: user.id,
            taskId,
            mimeType: proofIntent.mimeType,
        });

        const { data: existingProof } = await (supabase.from("task_completion_proofs") as any)
            .select("bucket, object_path")
            .eq("task_id", taskId as any)
            .maybeSingle();

        if (existingProof?.object_path) {
            await (supabase.storage.from((existingProof.bucket as string) || TASK_PROOFS_BUCKET) as any)
                .remove([(existingProof.object_path as string)]);
        }

        const { error: proofError } = await (supabase.from("task_completion_proofs") as any)
            .upsert(
                {
                    task_id: taskId,
                    owner_id: user.id,
                    voucher_id: (task as any).voucher_id,
                    bucket: TASK_PROOFS_BUCKET,
                    object_path: objectPath,
                    media_kind: proofIntent.mediaKind,
                    mime_type: proofIntent.mimeType,
                    size_bytes: proofIntent.sizeBytes,
                    duration_ms: proofIntent.durationMs ?? null,
                    overlay_timestamp_text: normalizeProofTimestampText(proofIntent.overlayTimestampText),
                    upload_state: "PENDING",
                },
                { onConflict: "task_id" }
            );

        if (proofError) {
            await (supabase.from("tasks") as any)
                .update({
                    status: (task as any).postponed_at ? "POSTPONED" : "ACTIVE",
                    marked_completed_at: null,
                    voucher_response_deadline: null,
                    proof_request_open: false,
                    proof_requested_at: null,
                    proof_requested_by: null,
                    updated_at: new Date().toISOString(),
                } as any)
                .eq("id", taskId as any)
                .eq("user_id", user.id as any)
                .eq("status", completionStatus as any);

            return { error: proofError.message };
        }

        const supabaseAdmin = createAdminClient();
        const { data: signedUpload, error: signedUploadError } = await supabaseAdmin.storage
            .from(TASK_PROOFS_BUCKET)
            .createSignedUploadUrl(objectPath);

        if (signedUploadError || !signedUpload?.token) {
            await (supabase.from("tasks") as any)
                .update({
                    status: (task as any).postponed_at ? "POSTPONED" : "ACTIVE",
                    marked_completed_at: null,
                    voucher_response_deadline: null,
                    proof_request_open: false,
                    proof_requested_at: null,
                    proof_requested_by: null,
                    updated_at: new Date().toISOString(),
                } as any)
                .eq("id", taskId as any)
                .eq("user_id", user.id as any)
                .eq("status", completionStatus as any);

            await deleteTaskProof(taskId, "signed_upload_url_failure");
            return { error: signedUploadError?.message || "Could not create proof upload session." };
        }

        proofUploadTarget = {
            bucket: TASK_PROOFS_BUCKET,
            objectPath,
            uploadToken: signedUpload.token,
        };
    } else {
        const cleanup = await deleteTaskProof(taskId, "mark_complete_without_proof");
        if (!cleanup.success) {
            return { error: cleanup.error || "Could not clear previous proof media." };
        }
    }

    await (supabase.from("task_events") as any).insert({
        task_id: (taskId as any),
        event_type: "MARK_COMPLETE",
        actor_id: (user as any).id,
        actor_user_client_instance_id: await resolveWebUserClientInstanceId(user.id),
        from_status: (task as any).status,
        to_status: completionStatus,
        metadata: proofIntent
            ? {
                has_proof: true,
                media_kind: proofIntent.mediaKind,
            }
            : null,
    });

    invalidateActiveTasksCache((user as any).id);
    invalidatePendingVoucherRequestsCache((task as any).voucher_id);
    await enqueueGoogleCalendarUpsert((user as any).id, taskId);
    revalidatePath("/tasks");
    revalidatePath("/stats");
    revalidatePath("/friends");
    revalidatePath(`/tasks/${taskId}`);
    return { success: true, proofUploadTarget };
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

    if (!canFinalizeOrRevertProof((task as any).status)) {
        return { error: `Cannot undo completion from ${(task as any).status} status` };
    }

    const nowIso = new Date().toISOString();
    if (new Date(nowIso) >= new Date((task as any).deadline)) {
        return { error: "Deadline has passed" };
    }

    const cleanup = await deleteTaskProof(taskId, "undo_complete");
    if (!cleanup.success) {
        return { error: cleanup.error || "Could not remove proof media." };
    }

    const restoredStatus: "ACTIVE" | "POSTPONED" = (task as any).postponed_at ? "POSTPONED" : "ACTIVE";

    // @ts-ignore
    const { data: updatedRows, error } = await (supabase.from("tasks") as any)
        .update({
            status: restoredStatus,
            marked_completed_at: null,
            voucher_response_deadline: null,
            proof_request_open: false,
            proof_requested_at: null,
            proof_requested_by: null,
            updated_at: nowIso,
        } as any)
        .eq("id", taskId as any)
        .eq("user_id", user.id as any)
        .eq("status", (task as any).status as any)
        .gt("deadline", nowIso)
        .select("id");

    if (error) {
        return { error: error.message };
    }

    if (!updatedRows || updatedRows.length === 0) {
        return { error: "Task can no longer be reverted. Please refresh." };
    }

    await (supabase.from("task_events") as any).insert({
        task_id: taskId as any,
        event_type: "UNDO_COMPLETE",
        actor_id: user.id,
        actor_user_client_instance_id: await resolveWebUserClientInstanceId(user.id),
        from_status: (task as any).status,
        to_status: restoredStatus,
    });

    await enqueueGoogleCalendarUpsert(user.id, taskId);

    invalidateActiveTasksCache(user.id);
    invalidatePendingVoucherRequestsCache((task as any).voucher_id);
    revalidatePath("/tasks");
    revalidatePath("/stats");
    revalidatePath("/friends");
    revalidatePath(`/tasks/${taskId}`);

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

    const { data: task } = await (supabase.from("tasks") as any)
        .select("*")
        .eq("id", (taskId as any))
        .eq("user_id", (user as any).id)
        .single();

    if (!task) {
        return { error: "Task not found" };
    }

    if ((task as any).status !== "DENIED" && (task as any).status !== "MISSED") {
        return { error: "Override can only be used on tasks that have been denied or missed." };
    }

    const now = new Date();
    const currentPeriod = now.toISOString().slice(0, 7);

    const failedPeriod = new Date((task as any).updated_at).toISOString().slice(0, 7);
    if (failedPeriod !== currentPeriod) {
        return { error: "Override can only be used on tasks that failed this month." };
    }

    const { count } = await supabase
        .from("overrides" as any)
        .select("*", { count: 'exact', head: true })
        .eq("user_id", user.id)
        .eq("period", currentPeriod);

    if ((count || 0) >= 1) {
        return { error: "You have already used your override for this month" };
    }

    const { error } = await (supabase.from("tasks") as any)
        .update({ status: "SETTLED", updated_at: now.toISOString() } as any)
        .eq("id", (taskId as any))
        .eq("user_id", user.id);

    if (error) {
        return { error: error.message };
    }

    await (supabase.from("overrides" as any) as any).insert({
        user_id: user.id,
        task_id: taskId as any,
        period: currentPeriod,
    });

    await (supabase.from("ledger_entries" as any) as any).insert({
        user_id: user.id,
        task_id: taskId as any,
        period: currentPeriod,
        amount_cents: -(task as any).failure_cost_cents,
        entry_type: "override",
    });

    await (supabase.from("task_events") as any).insert({
        task_id: taskId as any,
        event_type: "OVERRIDE",
        actor_id: user.id,
        actor_user_client_instance_id: await resolveWebUserClientInstanceId(user.id),
        from_status: (task as any).status,
        to_status: "SETTLED",
    });

    await enqueueGoogleCalendarUpsert(user.id, taskId);

    revalidatePath(`/tasks/${taskId}`);
    revalidatePath("/tasks");
    return { success: true };
}

// Re-export type for external consumers
export type { MarkTaskCompleteWithProofResult };
