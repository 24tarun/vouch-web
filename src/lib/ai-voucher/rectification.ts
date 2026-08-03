/* eslint-disable @typescript-eslint/no-explicit-any */
import { tasks as triggerTasks } from "@trigger.dev/sdk/v3";
import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateProofWithGemini } from "@/lib/ai-voucher/gemini";
import { sendNotification } from "@/lib/notifications";
import { deleteTaskProof } from "@/lib/task-proof";
import { enqueueGoogleCalendarOutbox } from "@/lib/google-calendar/sync";
import { notifyCommitmentRevivedIfNeeded } from "@/actions/commitments";

export async function queueAiRectificationEvaluation(requestId: string) {
    await triggerTasks.trigger("ai-rectification-evaluate", { requestId });
}

export async function processAiRectificationDecision(
    requestId: string,
    options?: { throwOnEvaluationError?: boolean },
) {
    const admin = createAdminClient();
    const { data: requestData, error: requestError } = await (admin.from("rectification_requests") as any)
        .select(`
            *,
            task:tasks!rectification_requests_task_id_fkey(
                id, user_id, title, description, deadline, original_deadline, postponed_at, status, recurrence_rule_id,
                task_completion_proofs(
                    id, bucket, object_path, media_kind, mime_type, upload_state,
                    proof_timestamp_at, proof_timestamp_source, proof_timezone
                )
            )
        `)
        .eq("id", requestId)
        .maybeSingle();
    if (requestError) throw requestError;
    if (!requestData) throw new Error("Rectification request not found");

    const request = requestData as any;
    const task = Array.isArray(request.task) ? request.task[0] : request.task;
    if (request.target_type !== "AI" || request.state !== "PENDING_AI") return { skipped: true };
    if (!task || task.status !== "AWAITING_RECTIFICATION") return { skipped: true };

    const rawProof = task.task_completion_proofs;
    const proof = (Array.isArray(rawProof) ? rawProof : [rawProof])
        .find((row: any) => row?.upload_state === "UPLOADED" && row?.object_path);
    if (!proof) throw new Error("Required rectification proof has not been uploaded");

    const { data: blob, error: downloadError } = await admin.storage
        .from(proof.bucket || "task-proofs")
        .download(proof.object_path);
    if (downloadError || !blob) throw downloadError || new Error("Rectification proof file is unavailable");

    let evaluation;
    try {
        const supplemental = request.reason
            ? `Rectification context supplied by the owner (supplemental only): ${request.reason}`
            : "The owner supplied no additional rectification context.";
        evaluation = await evaluateProofWithGemini({
            taskTitle: task.title,
            taskDescription: [task.description, `Original outcome: ${request.original_status}.`, supplemental]
                .filter(Boolean)
                .join("\n\n"),
            timing: {
                mode: "rectification",
                originalDeadline: task.original_deadline,
                effectiveDeadline: task.deadline,
                postponedAt: task.postponed_at,
                proofTimestampAt: proof.proof_timestamp_at,
                proofTimestampSource: proof.proof_timestamp_source,
                proofTimezone: proof.proof_timezone,
            },
            proofBuffer: Buffer.from(await blob.arrayBuffer()),
            mimeType: proof.mime_type,
            mediaKind: proof.media_kind,
        });
    } catch (error) {
        console.error(`AI rectification evaluation failed for ${requestId}:`, error);
        if (options?.throwOnEvaluationError) throw error;
        return { technicalFailure: true };
    }

    const decision = evaluation.decision === "approved" ? "APPROVE" : "DECLINE";
    const reason = evaluation.reason || (decision === "APPROVE" ? "Proof supports rectification" : "Proof does not support rectification");
    const { error: decisionError } = await (admin.rpc("record_ai_rectification_decision" as any, {
        p_request_id: requestId,
        p_decision: decision,
        p_reason: reason,
    } as any) as any);
    if (decisionError) throw decisionError;

    if (decision === "APPROVE") {
        await Promise.allSettled([
            deleteTaskProof(task.id, "ai_rectification_approved"),
            enqueueGoogleCalendarOutbox(task.user_id, task.id, "UPSERT"),
            notifyCommitmentRevivedIfNeeded(task.id, task.recurrence_rule_id ?? null),
        ]);
    }

    await sendNotification({
        userId: request.owner_id,
        title: decision === "APPROVE" ? "Task rectified" : "AI rectification declined",
        text: decision === "APPROVE"
            ? `AI approved rectification for “${task.title}”.`
            : `AI declined rectification for “${task.title}”. You can appeal up to three times${request.original_voucher_id !== request.owner_id ? " or ask the original voucher" : ""}.`,
        url: `/tasks/${task.id}`,
        tag: `rectification-${request.id}-ai-${decision.toLowerCase()}-${request.ai_appeal_count}`,
        data: {
            kind: decision === "APPROVE" ? "RECTIFICATION_APPROVED" : "RECTIFICATION_AI_DENIED",
            taskId: task.id,
            requestId: request.id,
        },
        email: false,
    });

    return { success: true, decision };
}

export async function notifyAiRectificationTechnicalFailure(requestId: string) {
    const admin = createAdminClient();
    const { data } = await (admin.from("rectification_requests") as any)
        .select("owner_id, task_id, task:tasks!rectification_requests_task_id_fkey(title)")
        .eq("id", requestId)
        .maybeSingle();
    if (!data) return;
    const row = data as any;
    const task = Array.isArray(row.task) ? row.task[0] : row.task;
    await sendNotification({
        userId: row.owner_id,
        title: "AI review delayed",
        text: `AI could not review “${task?.title || "your task"}” after several attempts. The request remains pending, and the existing rectification deadline remains in place.`,
        url: `/tasks/${row.task_id}`,
        tag: `rectification-${requestId}-ai-technical-failure`,
        data: { kind: "RECTIFICATION_AI_TECHNICAL_FAILURE", taskId: row.task_id, requestId },
        email: false,
    });
}
