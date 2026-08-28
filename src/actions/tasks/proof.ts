"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteTaskProof, TASK_PROOFS_BUCKET, buildTaskProofObjectPath } from "@/lib/task-proof";
import { type TaskProofIntent, type TaskProofMetadata } from "@/lib/task-proof";
import {
    canInitAwaitingProofUpload,
    canFinalizeProofStaging,
    canFinalizeOrRevertProof,
    PROOF_FINALIZE_OR_REVERT_STATUSES,
} from "@/lib/task-proof-routing";
import { resolveWebUserClientInstanceId } from "@/lib/user-client-instance";
import { normalizeProofTimestampText } from "@/lib/proof-timestamp";
import { aiEvaluationLimiter, checkRateLimit } from "@/lib/rate-limit";
import { AI_PROFILE_ID } from "@/lib/ai-voucher/constants";
import {
    isTaskCompletionLocked,
    wasProofStagedBeforeCompletionLock,
} from "@/lib/task-submission-window";
import {
    invalidateActiveTasksCache,
    invalidatePendingVoucherRequestsCache,
    validateProofIntent,
    INVALID_TASK_PROOF_ERROR,
    type MarkTaskCompleteWithProofResult,
} from "./helpers";
import { runOrchestratedTaskCommand, runTaskCommand } from "./command";

const COMPLETION_EDIT_LOCKED_ERROR = "The task deadline has passed. Proof and completion can no longer be changed.";

async function triggerAiEvaluationForProof(taskId: string, mediaKind: "image" | "video", ownerId: string): Promise<{ error?: string }> {
    const { limited } = await checkRateLimit(aiEvaluationLimiter, `ai-eval:${ownerId}`);
    if (limited) {
        return { error: "Too many AI proof evaluations right now. Please wait a bit and try again." };
    }

    if (mediaKind === "image") {
        const { processAiVoucherDecision } = await import("@/lib/ai-voucher/evaluate");
        try {
            await processAiVoucherDecision(taskId);
        } catch (error) {
            console.error(`AI voucher evaluation failed: ${error}`);
        }
        return {};
    }

    try {
        const { tasks: triggerTasks } = await import("@trigger.dev/sdk/v3");
        await triggerTasks.trigger("ai-voucher-evaluate", { taskId });
    } catch (error) {
        console.error(`Failed to queue AI voucher video evaluation: ${error}`);
    }

    return {};
}

export async function initAwaitingVoucherProofUpload(
    taskId: string,
    rawProofIntent: TaskProofIntent
): Promise<MarkTaskCompleteWithProofResult> {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const proofValidation = validateProofIntent(rawProofIntent);
    if (proofValidation.error || !proofValidation.proofIntent) {
        return { error: proofValidation.error || INVALID_TASK_PROOF_ERROR };
    }

    const proofIntent = proofValidation.proofIntent;
    const { data: task } = await (supabase.from("tasks") as any)
        .select("id, user_id, voucher_id, status, deadline")
        .eq("id", taskId as any)
        .eq("user_id", user.id as any)
        .single();

    if (!task) {
        return { error: "Task not found" };
    }

    if (!canInitAwaitingProofUpload((task as any).status)) {
        return { error: "Task is no longer awaiting voucher response." };
    }

    if ((task as any).status !== "AWAITING_RECTIFICATION" && isTaskCompletionLocked((task as any).status, (task as any).deadline)) {
        return { error: COMPLETION_EDIT_LOCKED_ERROR };
    }

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

    if (existingProof) {
        await (supabase.from("task_completion_proofs") as any)
            .delete()
            .eq("task_id", taskId as any)
            .eq("owner_id", user.id as any);
    }

    const { error: proofError } = await (supabase.from("task_completion_proofs") as any)
        .insert({
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
        });

    if (proofError) {
        return { error: proofError.message };
    }

    const supabaseAdmin = createAdminClient();
    const { data: signedUpload, error: signedUploadError } = await supabaseAdmin.storage
        .from(TASK_PROOFS_BUCKET)
        .createSignedUploadUrl(objectPath);

    if (signedUploadError || !signedUpload?.token) {
        await (supabase.from("task_completion_proofs") as any)
            .update({
                upload_state: "FAILED",
                updated_at: new Date().toISOString(),
            } as any)
            .eq("task_id", taskId as any)
            .eq("owner_id", user.id as any);
        return { error: signedUploadError?.message || "Could not create proof upload session." };
    }

    return {
        success: true,
        proofUploadTarget: {
            bucket: TASK_PROOFS_BUCKET,
            objectPath,
            uploadToken: signedUpload.token,
        },
    };
}

async function removeTaskProofCommand(taskId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const command = await runTaskCommand(supabase, "remove_task_proof_v2", {
        p_task_id: taskId,
        p_actor_user_client_instance_id: await resolveWebUserClientInstanceId(user.id),
    });
    if (!command.success) return { error: command.message };

    const cleanup = await deleteTaskProof(taskId, "owner_remove_proof_post_command");
    if (!cleanup.success) {
        console.error(`Post-command proof cleanup deferred for task ${taskId}:`, cleanup.error);
    }

    const task = command.task;
    invalidateActiveTasksCache(user.id);
    if (typeof task?.voucher_id === "string") {
        invalidatePendingVoucherRequestsCache(task.voucher_id);
    }
    revalidatePath("/tasks");
    revalidatePath("/settings");
    revalidatePath("/friends");
    revalidatePath(`/tasks/${taskId}`);
    return {
        success: true,
        status: command.fromStatus === command.toStatus ? null : command.toStatus as "ACTIVE" | "POSTPONED",
    };
}

export async function removeTaskProofAttachment(taskId: string) {
    return removeTaskProofCommand(taskId);
}

export async function finalizeTaskProofUpload(taskId: string, proofMeta: TaskProofMetadata) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const proofValidation = validateProofIntent({
        mediaKind: proofMeta.mediaKind,
        mimeType: proofMeta.mimeType,
        sizeBytes: proofMeta.sizeBytes,
        durationMs: proofMeta.durationMs ?? null,
        overlayTimestampText: proofMeta.overlayTimestampText,
    });
    if (proofValidation.error) {
        return { error: proofValidation.error };
    }

    const { data: task } = await (supabase.from("tasks") as any)
        .select("id, user_id, voucher_id, status, deadline")
        .eq("id", taskId as any)
        .eq("user_id", user.id as any)
        .single();

    if (!task) {
        return { error: "Task not found" };
    }

    if (!canFinalizeProofStaging((task as any).status)) {
        return { error: "Task is no longer awaiting voucher response." };
    }

    const { data: proofRow, error: proofFetchError } = await (supabase.from("task_completion_proofs") as any)
        .select("id, object_path, bucket, owner_id, created_at, updated_at")
        .eq("task_id", taskId as any)
        .eq("owner_id", user.id as any)
        .maybeSingle();

    if (proofFetchError) {
        return { error: proofFetchError.message };
    }

    if (!proofRow) {
        return { error: "Proof record not found." };
    }

    if (
        (task as any).status !== "AWAITING_RECTIFICATION" &&
        isTaskCompletionLocked((task as any).status, (task as any).deadline) &&
        !wasProofStagedBeforeCompletionLock(
            (task as any).deadline,
            (proofRow as any).updated_at || (proofRow as any).created_at
        )
    ) {
        return { error: COMPLETION_EDIT_LOCKED_ERROR };
    }

    if (proofRow.bucket !== proofMeta.bucket || proofRow.object_path !== proofMeta.objectPath) {
        return { error: "Proof upload target mismatch." };
    }

    const { error: updateError } = await (supabase.from("task_completion_proofs") as any)
        .update({
            media_kind: proofMeta.mediaKind,
            mime_type: proofMeta.mimeType,
            size_bytes: proofMeta.sizeBytes,
            duration_ms: proofMeta.durationMs ?? null,
            overlay_timestamp_text: normalizeProofTimestampText(proofMeta.overlayTimestampText),
            upload_state: "UPLOADED",
            updated_at: new Date().toISOString(),
        } as any)
        .eq("id", proofRow.id as any)
        .eq("owner_id", user.id as any);

    if (updateError) {
        return { error: updateError.message };
    }

    let effectiveStatus = (task as any).status as string;
    let aiQueuedByCommand = false;
    if (["ACTIVE", "POSTPONED"].includes(effectiveStatus)) {
        const command = await runOrchestratedTaskCommand(supabase as any, {
            action: "complete-task-command",
            taskId,
            clientActionAt: (proofRow as any).created_at ?? new Date().toISOString(),
            actorUserClientInstanceId: await resolveWebUserClientInstanceId(user.id),
        });
        if (!command.success) return { error: command.message };
        effectiveStatus = command.toStatus ?? effectiveStatus;
        aiQueuedByCommand = effectiveStatus === "AWAITING_AI";
    }

    const nowIso = new Date().toISOString();
    const { error: clearProofRequestError } = await (supabase.from("tasks") as any)
        .update({
            proof_request_open: false,
            proof_requested_at: null,
            proof_requested_by: null,
            updated_at: nowIso,
        } as any)
        .eq("id", taskId as any)
        .eq("user_id", user.id as any)
        .in("status", ["AWAITING_VOUCHER", "AWAITING_AI", "AWAITING_USER", "MARKED_COMPLETE", "AWAITING_RECTIFICATION"] as any);

    if (clearProofRequestError) {
        return { error: clearProofRequestError.message };
    }

    const { error: proofUploadedEventError } = await (supabase.from("task_events") as any).insert({
        task_id: taskId as any,
        event_type: effectiveStatus === "AWAITING_RECTIFICATION"
            ? "RECTIFICATION_PROOF_UPLOADED"
            : "PROOF_UPLOADED",
        actor_id: user.id as any,
        actor_user_client_instance_id: await resolveWebUserClientInstanceId(user.id),
        from_status: effectiveStatus,
        to_status: effectiveStatus,
        metadata: {
            media_kind: proofMeta.mediaKind,
            mime_type: proofMeta.mimeType,
            size_bytes: proofMeta.sizeBytes,
            duration_ms: proofMeta.durationMs ?? null,
        },
    });
    if (proofUploadedEventError) {
        console.error("Failed to log PROOF_UPLOADED event:", proofUploadedEventError);
    }

    if ((task as any).voucher_id === AI_PROFILE_ID && effectiveStatus === "AWAITING_AI" && !aiQueuedByCommand) {
        const aiResult = await triggerAiEvaluationForProof(taskId, proofMeta.mediaKind, user.id);
        if (aiResult.error) {
            return aiResult;
        }
    } else if (effectiveStatus === "AWAITING_RECTIFICATION") {
        const { data: request } = await (supabase.from("rectification_requests") as any)
            .select("id")
            .eq("task_id", taskId as any)
            .in("state", ["PENDING_HUMAN", "PENDING_AI", "AWAITING_AI_APPEAL"] as any)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (request?.id) {
            const { notifyRectificationProofUploaded } = await import("@/actions/rectification");
            const notificationResult = await notifyRectificationProofUploaded(request.id as string);
            if ("error" in notificationResult) return notificationResult;
        }
    }

    invalidatePendingVoucherRequestsCache((task as any).voucher_id);
    revalidatePath("/tasks");
    revalidatePath("/settings");
    revalidatePath("/friends");
    revalidatePath(`/tasks/${taskId}`);
    return { success: true };
}

export async function submitAwaitingUserProofToAi(
    taskId: string
): Promise<{ success?: true; error?: string }> {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const { data: task } = await (supabase.from("tasks") as any)
        .select("id, user_id, voucher_id, status")
        .eq("id", taskId as any)
        .eq("user_id", user.id as any)
        .single();

    if (!task) {
        return { error: "Task not found" };
    }

    if ((task as any).status !== "AWAITING_USER") {
        return { error: `Task is in ${(task as any).status} status and cannot be resubmitted.` };
    }

    if ((task as any).voucher_id !== AI_PROFILE_ID) {
        return { error: "Only AI-vouched tasks can be resubmitted to AI." };
    }

    const { data: proofRow } = await (supabase.from("task_completion_proofs") as any)
        .select("id, media_kind, upload_state")
        .eq("task_id", taskId as any)
        .eq("owner_id", user.id as any)
        .maybeSingle();

    if (!proofRow || proofRow.upload_state !== "UPLOADED" || !proofRow.media_kind) {
        return { error: "Upload proof first before resubmitting to AI." };
    }

    const command = await runOrchestratedTaskCommand(supabase as any, {
        action: "submit-ai-appeal-command",
        taskId,
        actorUserClientInstanceId: await resolveWebUserClientInstanceId(user.id),
    });
    if (!command.success) return { error: command.message };

    invalidatePendingVoucherRequestsCache((task as any).voucher_id);
    revalidatePath("/tasks");
    revalidatePath("/settings");
    revalidatePath("/friends");
    revalidatePath(`/tasks/${taskId}`);

    return { success: true };
}

export async function revertTaskCompletionAfterProofFailure(taskId: string) {
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

    let restoredStatus = (task as any).status as "ACTIVE" | "POSTPONED";
    if (!["ACTIVE", "POSTPONED"].includes((task as any).status)) {
        if (!canFinalizeOrRevertProof((task as any).status)) {
            return { error: `Cannot revert completion from ${(task as any).status} status` };
        }
        const command = await runTaskCommand(supabase as any, "undo_task_completion_v2", {
            p_task_id: taskId,
            p_actor_user_client_instance_id: await resolveWebUserClientInstanceId(user.id),
        });
        if (!command.success) return { error: command.message };
        restoredStatus = command.toStatus as "ACTIVE" | "POSTPONED";
    }

    const cleanup = await deleteTaskProof(taskId, "proof_upload_failure_revert");
    if (!cleanup.success) {
        console.error(`Post-command proof cleanup failed for task ${taskId}:`, cleanup.error);
    }

    invalidateActiveTasksCache(user.id);
    invalidatePendingVoucherRequestsCache((task as any).voucher_id);
    revalidatePath("/tasks");
    revalidatePath("/settings");
    revalidatePath("/friends");
    revalidatePath(`/tasks/${taskId}`);

    return { success: true, status: restoredStatus };
}
