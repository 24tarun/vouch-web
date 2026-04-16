/**
 * AI Voucher Decision Processor
 *
 * Orchestrates the end-to-end flow: fetch task → download proof → evaluate with Gemini →
 * update task + create ledger/events → send notification
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath, revalidateTag } from "next/cache";
import { sendNotification } from "@/lib/notifications";
import { deleteTaskProof } from "@/lib/task-proof";
import { evaluateProofWithGemini, type ProofEvaluationResult } from "./gemini";
import { AI_PROFILE_ID } from "./constants";
import { activeTasksTag } from "@/lib/cache-tags";
import { enqueueGoogleCalendarOutbox } from "@/lib/google-calendar/sync";

interface ProcessAiVoucherDecisionOptions {
  throwOnEvaluationError?: boolean;
  notifyOnEvaluationError?: boolean;
}

export async function processAiVoucherDecision(
  taskId: string,
  options?: ProcessAiVoucherDecisionOptions
): Promise<void> {
  const throwOnEvaluationError = options?.throwOnEvaluationError ?? false;
  const notifyOnEvaluationError = options?.notifyOnEvaluationError ?? true;

  try {
    // 1. Fetch task + proof row using admin client
    const adminClient = createAdminClient();

    const { data: taskData } = await adminClient
      .from("tasks")
      .select(
        `
        *,
        user:profiles!tasks_user_id_fkey(id, email, username),
        task_completion_proofs(id, object_path, media_kind, mime_type, size_bytes)
      `
      )
      .eq("id", taskId)
      .single();

    if (!taskData) {
      console.error(`Task not found: ${taskId}`);
      return;
    }

    const task = taskData as any;

    // 2. Verify preconditions
    if (task.voucher_id !== AI_PROFILE_ID) {
      console.error(
        `Task ${taskId} is not AI-vouched (voucher: ${task.voucher_id})`
      );
      return;
    }

    if (task.status === "MARKED_COMPLETE") {
      const { error: routeError } = await (adminClient.from("tasks") as any)
        .update({ status: "AWAITING_AI" } as any)
        .eq("id", taskId)
        .eq("status", "MARKED_COMPLETE");
      if (routeError) {
        console.error(`Failed to route MARKED_COMPLETE task ${taskId} to AWAITING_AI: ${routeError.message}`);
        return;
      }
      task.status = "AWAITING_AI";
    }

    if (task.status !== "AWAITING_AI") {
      console.error(
        `Task ${taskId} is in ${task.status} status, expected AWAITING_AI`
      );
      return;
    }

    const proofRaw = task.task_completion_proofs;
    const proof = Array.isArray(proofRaw)
      ? proofRaw.find((p: any) => p?.object_path)
      : proofRaw?.object_path ? proofRaw : null;

    if (!proof) {
      console.error(`No proof found for task ${taskId}`);
      // Mark as failed since AI can't vouch without evidence
      await failTask(taskId, task, "No proof submitted");
      return;
    }

    // 3. Download proof binary from storage
    console.log(`Downloading proof for task ${taskId}`);
    const { data: proofBuffer, error: downloadError } =
      await adminClient.storage
        .from("task-proofs")
        .download(proof.object_path);

    if (downloadError || !proofBuffer) {
      console.error(`Failed to download proof: ${downloadError?.message}`);
      await failTask(taskId, task, "Proof file unavailable");
      return;
    }

    // 4. Call Gemini evaluation
    console.log(
      `Evaluating proof for task ${taskId} (${proof.media_kind}, ${proof.mime_type})`
    );
    let decision: ProofEvaluationResult;
    const proofBytes = Buffer.from(await proofBuffer.arrayBuffer());

    try {
      decision = await evaluateProofWithGemini({
        taskTitle: task.title,
        taskDeadline: task.deadline,
        proofBuffer: proofBytes,
        mimeType: proof.mime_type,
        mediaKind: proof.media_kind,
      });
    } catch (error) {
      console.error(`Gemini evaluation failed: ${error}`);
      if (throwOnEvaluationError) {
        throw error;
      }
      // Leave task in AWAITING_AI so user can escalate or retry.
      if (notifyOnEvaluationError) {
        await sendEvaluationErrorNotification(task, error);
      }
      return;
    }

    // 5. Process the decision
    console.log(`Decision for task ${taskId}: ${decision.decision}`);

    if (decision.decision === "approved") {
      await approveTask(taskId, task, decision.reason);
    } else {
      await denyTask(taskId, task, decision.reason || "Proof does not match task");
    }
  } catch (error) {
    console.error(`Unexpected error in processAiVoucherDecision: ${error}`);
    if (throwOnEvaluationError) {
      throw error;
    }
  }
}

export async function notifyAiVoucherEvaluationErrorByTaskId(
  taskId: string,
  error: unknown
): Promise<void> {
  const adminClient = createAdminClient();
  const { data: taskData } = await adminClient
    .from("tasks")
    .select(
      `
      id,
      title,
      voucher_id,
      user:profiles!tasks_user_id_fkey(id, email, username)
    `
    )
    .eq("id", taskId)
    .single();

  if (!taskData) {
    return;
  }

  const task = taskData as any;
  if (task.voucher_id !== AI_PROFILE_ID) {
    return;
  }

  await sendEvaluationErrorNotification(task, error);
}

/**
 * Mark task as AI_ACCEPTED, delete proof, write AI_APPROVE event
 */
async function approveTask(taskId: string, task: any, reason?: string): Promise<void> {
  const adminClient = createAdminClient();

  // Delete proof from storage + DB
  const cleanup = await deleteTaskProof(taskId, "ai_voucher_approve");
  if (!cleanup.success) {
    console.error(
      `Failed to delete proof for approved task ${taskId}: ${cleanup.error}`
    );
    // Continue anyway; task is about to be marked complete
  }

  // Update task to AI_ACCEPTED
  const { error: updateError } = await (adminClient.from("tasks") as any)
    .update({
      status: "AI_ACCEPTED",
      has_proof: cleanup.deleted,
      proof_request_open: false,
      proof_requested_at: null,
      proof_requested_by: null,
    })
    .eq("id", taskId);

  if (updateError) {
    console.error(`Failed to update task ${taskId}: ${updateError.message}`);
    return;
  }

  // Record in ai_vouches
  await (adminClient.from("ai_vouches") as any).insert({
    task_id: taskId,
    attempt_number: (task.resubmit_count ?? 0) + 1,
    decision: "approved",
    reason: reason ?? "",
    approved_at: new Date().toISOString(),
  });

  // Write task event
  await (adminClient.from("task_events") as any).insert({
    task_id: taskId,
    event_type: "AI_APPROVE",
    actor_id: AI_PROFILE_ID,
    from_status: "AWAITING_AI",
    to_status: "AI_ACCEPTED",
  });

  // Enqueue Google Calendar upsert
  await enqueueGoogleCalendarOutbox(task.user_id, taskId, "UPSERT");

  // Push notification only (no email)
  await sendNotification({
    userId: task.user.id,
    title: "Task approved",
    text: `AI approved your proof for "${task.title}".`,
    url: `/tasks/${taskId}`,
    tag: `task-approved-${taskId}`,
    data: { taskId, kind: "TASK_AI_APPROVED" },
  });

  // Invalidate caches
  revalidateTag(activeTasksTag(task.user_id), "max");
  revalidatePath("/tasks");
  revalidatePath("/stats");
  revalidatePath(`/tasks/${taskId}`);
}

/**
 * Mark task as AI_DENIED -> AWAITING_USER (appeal/escalation path), create denial record
 */
async function denyTask(
  taskId: string,
  task: any,
  reason: string
): Promise<void> {
  const adminClient = createAdminClient();

  // Delete proof from storage + DB
  const cleanup = await deleteTaskProof(taskId, "ai_voucher_deny");
  if (!cleanup.success) {
    console.error(
      `Failed to delete proof for denied task ${taskId}: ${cleanup.error}`
    );
  }

  const attemptNumber = (task.resubmit_count ?? 0) + 1;

  // Record in ai_vouches
  await (adminClient.from("ai_vouches") as any).insert({
    task_id: taskId,
    attempt_number: attemptNumber,
    decision: "denied",
    reason,
  });

  // AI denial -> AI_DENIED (transitional) -> AWAITING_USER
  // No penalty at AI denial stage; penalty only on owner's acceptDenial action
  const { error: updateError } = await (adminClient.from("tasks") as any)
    .update({
      status: "AWAITING_USER",
      resubmit_count: attemptNumber,
      ai_vouch_calls_count: (task.ai_vouch_calls_count ?? 0) + 1,
      proof_request_open: false,
      proof_requested_at: null,
      proof_requested_by: null,
    } as any)
    .eq("id", taskId);

  if (updateError) {
    console.error(`Failed to update task ${taskId}: ${updateError.message}`);
    return;
  }

  // Write AI_DENIED transitional event, then auto-hop to AWAITING_USER
  await (adminClient.from("task_events") as any).insert([
    {
      task_id: taskId,
      event_type: "AI_DENY",
      actor_id: AI_PROFILE_ID,
      from_status: "AWAITING_AI",
      to_status: "AI_DENIED",
      metadata: { reason },
    },
    {
      task_id: taskId,
      event_type: "AI_DENIED_AUTO_HOP",
      actor_id: AI_PROFILE_ID,
      from_status: "AI_DENIED",
      to_status: "AWAITING_USER",
      metadata: { reason },
    },
  ]);

  // Determine remaining appeals (cap: 3 total reviews)
  const attemptsRemaining = 3 - attemptNumber;

  // Push notification only (no email)
  await sendNotification({
    userId: task.user.id,
    title: "Proof denied by AI",
    text: attemptsRemaining > 0
      ? `AI denied your proof for "${task.title}". You can appeal (${attemptsRemaining} left), escalate, or accept the denial.`
      : `AI denied your proof for "${task.title}". You can escalate to a friend or accept the denial.`,
    url: `/tasks/${taskId}`,
    tag: `task-denied-resubmit-${taskId}`,
    data: { taskId, kind: "TASK_AI_DENIED_RESUBMIT" },
  });

  // Invalidate caches
  revalidateTag(activeTasksTag(task.user_id), "max");
  revalidatePath("/tasks");
  revalidatePath("/stats");
  revalidatePath(`/tasks/${taskId}`);
}

/**
 * Mark task as AI_DENIED -> AWAITING_USER due to missing proof
 */
async function failTask(
  taskId: string,
  task: any,
  reason: string
): Promise<void> {
  const adminClient = createAdminClient();

  // Delete proof if any
  await deleteTaskProof(taskId, "ai_voucher_fail");

  // No proof -> AI_DENIED -> AWAITING_USER (no penalty at this stage)
  const { error: updateError } = await (adminClient.from("tasks") as any)
    .update({
      status: "AWAITING_USER",
      proof_request_open: false,
      proof_requested_at: null,
      proof_requested_by: null,
    })
    .eq("id", taskId);

  if (updateError) {
    console.error(`Failed to update task ${taskId}: ${updateError.message}`);
    return;
  }

  // Write AI_DENIED transitional event, then auto-hop to AWAITING_USER
  await (adminClient.from("task_events") as any).insert([
    {
      task_id: taskId,
      event_type: "AI_DENY",
      actor_id: AI_PROFILE_ID,
      from_status: "AWAITING_AI",
      to_status: "AI_DENIED",
      metadata: { reason },
    },
    {
      task_id: taskId,
      event_type: "AI_DENIED_AUTO_HOP",
      actor_id: AI_PROFILE_ID,
      from_status: "AI_DENIED",
      to_status: "AWAITING_USER",
      metadata: { reason },
    },
  ]);

  // Send push notification
  if (task.user?.id) {
    await sendNotification({
      userId: task.user.id,
      title: "Proof issue — AI needs evidence",
      text: `${reason}. You can resubmit, escalate to a friend, or accept the denial.`,
      email: false,
      push: true,
      url: `/tasks/${taskId}`,
      tag: `task-failed-${taskId}`,
      data: { taskId, kind: "TASK_AI_DENIED_RESUBMIT" },
    });
  }

  // Invalidate caches
  revalidateTag(activeTasksTag(task.user_id), "max");
  revalidatePath("/tasks");
  revalidatePath("/stats");
  revalidatePath(`/tasks/${taskId}`);
}

/**
 * Send notification when evaluation fails (Gemini error, etc.)
 * Task stays in AWAITING_AI so user can escalate
 */
async function sendEvaluationErrorNotification(
  task: any,
  error: unknown
): Promise<void> {
  if (!task.user?.id) return;

  const errorMsg = error instanceof Error ? error.message : String(error);

  await sendNotification({
    userId: task.user.id,
    title: "Evaluation error",
    text: `AI could not evaluate your proof. Please try again or escalate to a friend.`,
    email: false,
    push: true,
    url: `/tasks/${task.id}`,
    tag: `task-eval-error-${task.id}`,
    data: { taskId: task.id, kind: "TASK_EVAL_ERROR" },
  });

  console.error(`Evaluation error for task ${task.id}: ${errorMsg}`);
}
