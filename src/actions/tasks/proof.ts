"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteTaskProof, TASK_PROOFS_BUCKET, buildTaskProofObjectPath } from "@/lib/task-proof";
import { type TaskProofIntent, type TaskProofMetadata } from "@/lib/task-proof";
import {
    canInitAwaitingProofUpload,
    canFinalizeOrRevertProof,
    getAwaitingProofReviewStatus,
    PROOF_FINALIZE_OR_REVERT_STATUSES,
} from "@/lib/task-proof-routing";
import { resolveWebUserClientInstanceId } from "@/lib/user-client-instance";
import { normalizeProofTimestampText } from "@/lib/proof-timestamp";
import { aiEvaluationLimiter, checkRateLimit } from "@/lib/rate-limit";
import {
    invalidateActiveTasksCache,
    invalidatePendingVoucherRequestsCache,
    enqueueGoogleCalendarUpsert,
    validateProofIntent,
    INVALID_TASK_PROOF_ERROR,
    type MarkTaskCompleteWithProofResult,
} from "./helpers";

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
        .select("id, user_id, voucher_id, status")
        .eq("id", taskId as any)
        .eq("user_id", user.id as any)
        .single();

    if (!task) {
        return { error: "Task not found" };
    }

    if (!canInitAwaitingProofUpload((task as any).status)) {
        return { error: "Task is no longer awaiting voucher response." };
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
        return { error: proofError.message };
    }

    const supabaseAdmin = createAdminClient();

    const routedAwaitingStatus = getAwaitingProofReviewStatus((task as any).voucher_id);

    if ((task as any).status === "AWAITING_USER" || (task as any).status === "MARKED_COMPLETE") {
        const { error: transitionError } = await (supabaseAdmin.from("tasks") as any)
            .update({ status: routedAwaitingStatus })
            .eq("id", taskId)
            .eq("status", (task as any).status as any);

        if (transitionError) {
            return { error: "Another resubmit is already in progress" };
        }
    }
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
        .select("id, user_id, voucher_id, status")
        .eq("id", taskId as any)
        .eq("user_id", user.id as any)
        .single();

    if (!task) {
        return { error: "Task not found" };
    }

    if (!canFinalizeOrRevertProof((task as any).status)) {
        return { error: "Task is no longer awaiting voucher response." };
    }

    const { data: proofRow, error: proofFetchError } = await (supabase.from("task_completion_proofs") as any)
        .select("id, object_path, bucket, owner_id")
        .eq("task_id", taskId as any)
        .eq("owner_id", user.id as any)
        .maybeSingle();

    if (proofFetchError) {
        return { error: proofFetchError.message };
    }

    if (!proofRow) {
        return { error: "Proof record not found." };
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
        .in("status", PROOF_FINALIZE_OR_REVERT_STATUSES as any);

    if (clearProofRequestError) {
        return { error: clearProofRequestError.message };
    }

    const { error: proofUploadedEventError } = await (supabase.from("task_events") as any).insert({
        task_id: taskId as any,
        event_type: "PROOF_UPLOADED",
        actor_id: user.id as any,
        actor_user_client_instance_id: await resolveWebUserClientInstanceId(user.id),
        from_status: (task as any).status,
        to_status: (task as any).status,
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

    const { AI_PROFILE_ID } = await import("@/lib/ai-voucher/constants");
    if ((task as any).voucher_id === AI_PROFILE_ID) {
        const { limited } = await checkRateLimit(aiEvaluationLimiter, `ai-eval:${user.id}`);
        if (limited) {
            return { error: "Too many AI proof evaluations right now. Please wait a bit and try again." };
        }

        if (proofMeta.mediaKind === "image") {
            const { processAiVoucherDecision } = await import("@/lib/ai-voucher/evaluate");
            try {
                await processAiVoucherDecision(taskId);
            } catch (error) {
                console.error(`AI voucher evaluation failed: ${error}`);
            }
        } else {
            try {
                const { tasks: triggerTasks } = await import("@trigger.dev/sdk/v3");
                await triggerTasks.trigger("ai-voucher-evaluate", { taskId });
            } catch (error) {
                console.error(`Failed to queue AI voucher video evaluation: ${error}`);
            }
        }
    }

    invalidatePendingVoucherRequestsCache((task as any).voucher_id);
    revalidatePath("/tasks");
    revalidatePath("/stats");
    revalidatePath("/friends");
    revalidatePath(`/tasks/${taskId}`);
    return { success: true };
}

export async function removeAwaitingVoucherProof(taskId: string) {
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

    if (!canFinalizeOrRevertProof((task as any).status)) {
        return { error: "Proof can only be removed while awaiting voucher response." };
    }

    const cleanup = await deleteTaskProof(taskId, "owner_remove_awaiting_proof");
    if (!cleanup.success) {
        return { error: cleanup.error || "Could not remove proof media." };
    }

    await (supabase.from("task_events") as any).insert({
        task_id: taskId as any,
        event_type: "PROOF_REMOVED",
        actor_id: user.id as any,
        actor_user_client_instance_id: await resolveWebUserClientInstanceId(user.id),
        from_status: (task as any).status,
        to_status: (task as any).status,
    });

    invalidatePendingVoucherRequestsCache((task as any).voucher_id);
    revalidatePath("/tasks");
    revalidatePath("/stats");
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

    if (!canFinalizeOrRevertProof((task as any).status)) {
        return { error: `Cannot revert completion from ${(task as any).status} status` };
    }

    const cleanup = await deleteTaskProof(taskId, "proof_upload_failure_revert");
    if (!cleanup.success) {
        return { error: cleanup.error || "Could not remove proof media." };
    }

    const nowIso = new Date().toISOString();
    if (new Date(nowIso) >= new Date((task as any).deadline)) {
        return { error: "Deadline has passed" };
    }

    const restoredStatus: "ACTIVE" | "POSTPONED" = (task as any).postponed_at ? "POSTPONED" : "ACTIVE";

    const { data: updatedRows, error: updateError } = await (supabase.from("tasks") as any)
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

    if (updateError) {
        return { error: updateError.message };
    }

    if (!updatedRows || updatedRows.length === 0) {
        return { error: "Task can no longer be reverted. Please refresh." };
    }

    await (supabase.from("task_events") as any).insert({
        task_id: taskId as any,
        event_type: "PROOF_UPLOAD_FAILED_REVERT",
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
