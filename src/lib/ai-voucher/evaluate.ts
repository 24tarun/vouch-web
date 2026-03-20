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
import { ORCA_PROFILE_ID } from "./constants";
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
    if (task.voucher_id !== ORCA_PROFILE_ID) {
      console.error(
        `Task ${taskId} is not AI-vouched (voucher: ${task.voucher_id})`
      );
      return;
    }

    if (task.status !== "AWAITING_VOUCHER") {
      console.error(
        `Task ${taskId} is in ${task.status} status, expected AWAITING_VOUCHER`
      );
      return;
    }

    if (!task.task_completion_proofs || task.task_completion_proofs.length === 0) {
      console.error(`No proof found for task ${taskId}`);
      // Mark as failed since AI can't vouch without evidence
      await failTask(taskId, task, "No proof submitted");
      return;
    }

    const proof = task.task_completion_proofs[0];

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
      // Leave task in AWAITING_VOUCHER so user can escalate or retry.
      if (notifyOnEvaluationError) {
        await sendEvaluationErrorNotification(task, error);
      }
      return;
    }

    // 5. Process the decision
    console.log(`Decision for task ${taskId}: ${decision.decision}`);

    if (decision.decision === "approved") {
      await approveTask(taskId, task);
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
  if (task.voucher_id !== ORCA_PROFILE_ID) {
    return;
  }

  await sendEvaluationErrorNotification(task, error);
}

/**
 * Mark task as COMPLETED, delete proof, write AI_APPROVE event
 */
async function approveTask(taskId: string, task: any): Promise<void> {
  const adminClient = createAdminClient();

  // Delete proof from storage + DB
  const cleanup = await deleteTaskProof(taskId, "ai_voucher_approve");
  if (!cleanup.success) {
    console.error(
      `Failed to delete proof for approved task ${taskId}: ${cleanup.error}`
    );
    // Continue anyway; task is about to be marked complete
  }

  // Update task to COMPLETED
  const { error: updateError } = await (adminClient.from("tasks") as any)
    .update({
      status: "COMPLETED",
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

  // Write task event
  await (adminClient.from("task_events") as any).insert({
    task_id: taskId,
    event_type: "AI_APPROVE",
    actor_id: ORCA_PROFILE_ID,
    from_status: "AWAITING_VOUCHER",
    to_status: "COMPLETED",
  });

  // Enqueue Google Calendar upsert
  await enqueueGoogleCalendarOutbox(task.user_id, taskId, "UPSERT");

  // Send success notification
  if (task.user?.email) {
    await sendNotification({
      to: task.user.email,
      userId: task.user.id,
      subject: `Orca has approved your task`,
      title: "Task approved",
      text: `Orca has reviewed your proof for "${task.title}" and approved it.`,
      html: `
        <h1>Orca has approved your task</h1>
        <p>Hi ${task.user.username || "there"},</p>
        <p>Orca reviewed your proof for <strong>${task.title}</strong> and approved it. You may proceed.</p>
        <p><a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/tasks/${taskId}">View task</a></p>
      `,
      url: `/dashboard/tasks/${taskId}`,
      tag: `task-approved-${taskId}`,
      data: { taskId, kind: "TASK_AI_APPROVED" },
    });
  }

  // Invalidate caches
  revalidateTag(activeTasksTag(task.user_id), "max");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/stats");
  revalidatePath(`/dashboard/tasks/${taskId}`);
}

/**
 * Mark task as FAILED or AWAITING_USER (for resubmit), create denial record
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

  // Determine if this is the final denial
  const currentCount = task.resubmit_count ?? 0;
  const isFinal = currentCount >= 2; // 3rd attempt = index 2
  const nextStatus = isFinal ? "FAILED" : "AWAITING_USER";
  const attemptNumber = currentCount + 1;

  // Always: Insert denial record
  await (adminClient.from("ai_vouch_denials") as any).insert({
    task_id: taskId,
    attempt_number: attemptNumber,
    reason,
  });

  // Update task status and counters
  const { error: updateError } = await (adminClient.from("tasks") as any)
    .update({
      status: nextStatus,
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

  // Write task event with denial reason in metadata
  await (adminClient.from("task_events") as any).insert({
    task_id: taskId,
    event_type: "AI_DENY",
    actor_id: ORCA_PROFILE_ID,
    from_status: "AWAITING_VOUCHER",
    to_status: nextStatus,
    metadata: { reason },
  });

  // If final: create ledger entry and enqueue Google Calendar delete
  if (isFinal) {
    const currentPeriod = new Date().toISOString().slice(0, 7);

    await (adminClient.from("ledger_entries") as any).insert({
      user_id: task.user_id,
      task_id: taskId,
      period: currentPeriod,
      amount_cents: task.failure_cost_cents,
      entry_type: "failure",
    });

    await enqueueGoogleCalendarOutbox(task.user_id, taskId, "DELETE");
  }

  // Send notification (content depends on final or not)
  if (task.user?.email) {
    const attemptsRemaining = 3 - attemptNumber;

    if (isFinal) {
      // Final denial notification
      await sendNotification({
        to: task.user.email,
        userId: task.user.id,
        subject: `Orca has denied your task (final decision)`,
        title: "Task denied",
        text: `Orca reviewed your proof and denied it: ${reason}`,
        html: `
          <h1>Orca has decided your fate</h1>
          <p>Hi ${task.user.username || "there"},</p>
          <p>Orca reviewed your proof for <strong>${task.title}</strong> for the final time.</p>
          <p><strong>Denied:</strong> ${reason}</p>
          <p>You have exhausted your resubmission attempts. Failure cost has been applied to your ledger. You can escalate this decision to a friend for a second opinion.</p>
          <p><a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/tasks/${taskId}">View task and escalate</a></p>
        `,
        url: `/dashboard/tasks/${taskId}`,
        tag: `task-denied-final-${taskId}`,
        data: { taskId, kind: "TASK_AI_DENIED_FINAL" },
      });
    } else {
      // Resubmit opportunity notification
      await sendNotification({
        to: task.user.email,
        userId: task.user.id,
        subject: `Orca needs more proof`,
        title: "Proof denied – try again",
        text: `Orca reviewed your proof and denied it. You have ${attemptsRemaining} more attempt${attemptsRemaining !== 1 ? "s" : ""}.`,
        html: `
          <h1>Orca needs more proof</h1>
          <p>Hi ${task.user.username || "there"},</p>
          <p>Orca reviewed your proof for <strong>${task.title}</strong>.</p>
          <p><strong>Denied:</strong> ${reason}</p>
          <p>You have <strong>${attemptsRemaining} more attempt${attemptsRemaining !== 1 ? "s" : ""}</strong> to submit new proof. Or escalate to a friend for a second opinion.</p>
          <p><a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/tasks/${taskId}">View task and resubmit</a></p>
        `,
        url: `/dashboard/tasks/${taskId}`,
        tag: `task-denied-resubmit-${taskId}`,
        data: { taskId, kind: "TASK_AI_DENIED_RESUBMIT" },
      });
    }
  }

  // Invalidate caches
  revalidateTag(activeTasksTag(task.user_id), "max");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/stats");
  revalidatePath(`/dashboard/tasks/${taskId}`);
}

/**
 * Mark task as FAILED due to missing proof
 */
async function failTask(
  taskId: string,
  task: any,
  reason: string
): Promise<void> {
  const adminClient = createAdminClient();

  // Delete proof if any
  await deleteTaskProof(taskId, "ai_voucher_fail");

  // Update task to FAILED
  const { error: updateError } = await (adminClient.from("tasks") as any)
    .update({
      status: "FAILED",
      proof_request_open: false,
      proof_requested_at: null,
      proof_requested_by: null,
    })
    .eq("id", taskId);

  if (updateError) {
    console.error(`Failed to update task ${taskId}: ${updateError.message}`);
    return;
  }

  // Create ledger entry
  const currentPeriod = new Date().toISOString().slice(0, 7);
  await (adminClient.from("ledger_entries") as any).insert({
    user_id: task.user_id,
    task_id: taskId,
    period: currentPeriod,
    amount_cents: task.failure_cost_cents,
    entry_type: "failure",
  });

  // Write task event
  await (adminClient.from("task_events") as any).insert({
    task_id: taskId,
    event_type: "AI_DENY",
    actor_id: ORCA_PROFILE_ID,
    from_status: "AWAITING_VOUCHER",
    to_status: "FAILED",
    metadata: { reason },
  });

  // Send notification
  if (task.user?.email) {
    await sendNotification({
      to: task.user.email,
      userId: task.user.id,
      subject: `Your task was rejected by Orca`,
      title: "Task rejected",
      text: `${reason}`,
      html: `
        <h1>Orca has decided your fate</h1>
        <p>Hi ${task.user.username || "there"},</p>
        <p><strong>${reason}</strong></p>
        <p><a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/tasks/${taskId}">View task</a></p>
      `,
      url: `/dashboard/tasks/${taskId}`,
      tag: `task-failed-${taskId}`,
      data: { taskId, kind: "TASK_FAILED" },
    });
  }

  // Invalidate caches
  revalidateTag(activeTasksTag(task.user_id), "max");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/stats");
  revalidatePath(`/dashboard/tasks/${taskId}`);
}

/**
 * Send notification when evaluation fails (Gemini error, etc.)
 * Task stays in AWAITING_VOUCHER so user can escalate
 */
async function sendEvaluationErrorNotification(
  task: any,
  error: unknown
): Promise<void> {
  if (!task.user?.email) return;

  const errorMsg = error instanceof Error ? error.message : String(error);

  await sendNotification({
    to: task.user.email,
    userId: task.user.id,
    subject: `Orca encountered an error`,
    title: "Evaluation error",
    text: `Orca could not evaluate your proof. Please try again or escalate to a friend.`,
    html: `
      <h1>Orca encountered an error</h1>
      <p>Hi ${task.user.username || "there"},</p>
      <p>While reviewing your proof for <strong>${task.title}</strong>, Orca encountered a technical issue.</p>
      <p>Your task is still awaiting review. Please try resubmitting your proof, or escalate to a friend for a second opinion.</p>
      <p><a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/tasks/${task.id}">View task</a></p>
    `,
    url: `/dashboard/tasks/${task.id}`,
    tag: `task-eval-error-${task.id}`,
    data: { taskId: task.id, kind: "TASK_EVAL_ERROR" },
  });

  console.error(`Evaluation error for task ${task.id}: ${errorMsg}`);
}


