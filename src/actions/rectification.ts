/* eslint-disable @typescript-eslint/no-explicit-any */
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveWebUserClientInstanceId } from "@/lib/user-client-instance";
import { sendNotification } from "@/lib/notifications";
import { deleteTaskProof } from "@/lib/task-proof";
import { enqueueGoogleCalendarOutbox } from "@/lib/google-calendar/sync";
import { notifyCommitmentRevivedIfNeeded } from "@/actions/commitments";
import type { Database, RectificationRequest } from "@/lib/types";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export type RectificationTarget = "ORIGINAL_VOUCHER" | "AI";

function messageFromError(error: unknown, fallback: string): string {
    if (error && typeof error === "object" && "message" in error) {
        const message = String((error as { message?: unknown }).message || "").trim();
        if (message) return message;
    }
    return fallback;
}

function refreshRectificationViews(taskId?: string) {
    revalidatePath("/tasks");
    revalidatePath("/friends");
    revalidatePath("/voucher");
    revalidatePath("/stats");
    revalidatePath("/ledger");
    if (taskId) revalidatePath(`/tasks/${taskId}`);
}

type ActorContext =
    | { error: string }
    | { supabase: SupabaseClient<Database>; user: User; instanceId: string | null };

async function actorContext(): Promise<ActorContext> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };
    return {
        supabase,
        user,
        instanceId: await resolveWebUserClientInstanceId(user.id),
    };
}

async function taskNotificationContext(taskId: string) {
    const admin = createAdminClient();
    const { data } = await (admin.from("tasks") as any)
        .select("id, title, user_id, voucher_id, recurrence_rule_id, owner:profiles!tasks_user_id_fkey(id, username), voucher:profiles!tasks_voucher_id_fkey(id, username)")
        .eq("id", taskId)
        .maybeSingle();
    return data as any;
}

async function notifyHumanRequest(request: RectificationRequest, kind: "REQUESTED" | "UPDATED" | "CANCELLED" | "PROOF_UPLOADED") {
    if (request.target_type !== "ORIGINAL_VOUCHER") return;
    const task = await taskNotificationContext(request.task_id);
    if (!task) return;
    const titles: Record<typeof kind, string> = {
        REQUESTED: "Rectification requested",
        UPDATED: "Rectification request updated",
        CANCELLED: "Rectification request cancelled",
        PROOF_UPLOADED: "Rectification proof uploaded",
    };
    const verbs: Record<typeof kind, string> = {
        REQUESTED: "requested rectification for",
        UPDATED: "updated the rectification request for",
        CANCELLED: "cancelled the rectification request for",
        PROOF_UPLOADED: "uploaded rectification proof for",
    };
    await sendNotification({
        userId: request.target_voucher_id,
        title: titles[kind],
        text: `${task.owner?.username || "A friend"} ${verbs[kind]} “${task.title}”.`,
        url: `/tasks/${request.task_id}`,
        tag: `rectification-${request.id}-${kind.toLowerCase()}`,
        data: { kind: `RECTIFICATION_${kind}`, taskId: request.task_id, requestId: request.id },
        email: false,
    });
}

async function postResolutionEffects(
    request: RectificationRequest,
    resolution: "APPROVED" | "AUTO_APPROVED" | "DECLINED",
    reason?: string | null,
) {
    const task = await taskNotificationContext(request.task_id);
    await deleteTaskProof(request.task_id, `rectification_${resolution.toLowerCase()}`);
    if (task) {
        await Promise.allSettled([
            enqueueGoogleCalendarOutbox(task.user_id, request.task_id, "UPSERT"),
            resolution === "APPROVED" || resolution === "AUTO_APPROVED"
                ? notifyCommitmentRevivedIfNeeded(request.task_id, task.recurrence_rule_id ?? null)
                : Promise.resolve(),
            sendNotification({
                userId: request.owner_id,
                title: resolution === "DECLINED" ? "Rectification declined" : "Task rectified",
                text: resolution === "DECLINED"
                    ? `Your rectification request for “${task.title}” was declined${reason ? `: ${reason}` : "."}`
                    : `“${task.title}” was rectified.`,
                url: `/tasks/${request.task_id}`,
                tag: `rectification-${request.id}-${resolution.toLowerCase()}`,
                data: { kind: `RECTIFICATION_${resolution}`, taskId: request.task_id, requestId: request.id },
                email: false,
            }),
        ]);
    }
    refreshRectificationViews(request.task_id);
}

export async function getRectificationContext(taskId: string) {
    const context = await actorContext();
    if (!("supabase" in context)) return context;
    const { supabase, user } = context;
    const [{ data: task }, { data: requests }, { data: passes }, { data: profile }] = await Promise.all([
        (supabase.from("tasks") as any)
            .select("id, user_id, voucher_id, status, failure_cost_cents, has_proof")
            .eq("id", taskId)
            .maybeSingle(),
        (supabase.from("rectification_requests") as any)
            .select("*")
            .eq("task_id", taskId)
            .order("created_at", { ascending: false }),
        (supabase.from("rectify_passes") as any)
            .select("id, period")
            .eq("user_id", user.id),
        (supabase.from("profiles") as any)
            .select("timezone")
            .eq("id", user.id)
            .maybeSingle(),
    ]);
    if (!task) return { error: "Task not found" };

    const latest = ((requests as RectificationRequest[] | null) || [])[0] ?? null;
    const timezone = (profile as { timezone?: string | null } | null)?.timezone || "UTC";
    const currentPeriod = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
    }).format(new Date());
    const period = latest?.request_period ?? currentPeriod;
    const used = ((passes as Array<{ period: string }> | null) || []).filter((pass) => pass.period === period).length;
    const { count: reserved = 0 } = await (supabase.from("rectification_requests") as any)
        .select("id", { count: "exact", head: true })
        .eq("owner_id", user.id)
        .eq("request_period", period)
        .in("state", ["PENDING_HUMAN", "PENDING_AI", "AWAITING_AI_APPEAL"]);
    return { success: true, task, request: latest, passes: { used, reserved: reserved || 0, limit: 5 } };
}

export async function getPendingRectificationsForVoucher() {
    const context = await actorContext();
    if (!("supabase" in context)) return [];
    const { data, error } = await (context.supabase.from("rectification_requests") as any)
        .select(`
            *,
            task:tasks!rectification_requests_task_id_fkey(
                id, title, description, failure_cost_cents, has_proof,
                user:profiles!tasks_user_id_fkey(id, username, currency),
                task_completion_proofs(*)
            )
        `)
        .eq("target_voucher_id", context.user.id)
        .eq("target_type", "ORIGINAL_VOUCHER")
        .eq("state", "PENDING_HUMAN")
        .order("updated_at", { ascending: false });
    if (error) {
        console.error("Failed loading pending rectifications:", error);
        return [];
    }
    return data || [];
}

export async function requestTaskRectification(taskId: string, target: RectificationTarget, reason?: string | null) {
    const context = await actorContext();
    if (!("supabase" in context)) return context;
    const { data, error } = await (context.supabase.rpc("request_task_rectification" as any, {
        p_task_id: taskId,
        p_target_type: target,
        p_reason: reason ?? null,
        p_actor_user_client_instance_id: context.instanceId,
    } as any) as any);
    if (error) return { error: messageFromError(error, "Could not request rectification") };
    const request = (Array.isArray(data) ? data[0] : data) as RectificationRequest | null;
    if (!request) return { error: "Could not create rectification request" };
    await notifyHumanRequest(request, "REQUESTED");
    refreshRectificationViews(taskId);
    return { success: true, request };
}

export async function updateTaskRectification(requestId: string, reason?: string | null) {
    const context = await actorContext();
    if (!("supabase" in context)) return context;
    const { data, error } = await (context.supabase.rpc("update_task_rectification" as any, {
        p_request_id: requestId,
        p_reason: reason ?? null,
        p_actor_user_client_instance_id: context.instanceId,
    } as any) as any);
    if (error) return { error: messageFromError(error, "Could not update rectification request") };
    const request = (Array.isArray(data) ? data[0] : data) as RectificationRequest;
    await notifyHumanRequest(request, "UPDATED");
    refreshRectificationViews(request.task_id);
    return { success: true, request };
}

export async function cancelTaskRectification(requestId: string) {
    const context = await actorContext();
    if (!("supabase" in context)) return context;
    const { data: existing } = await (context.supabase.from("rectification_requests") as any)
        .select("*").eq("id", requestId).eq("owner_id", context.user.id).maybeSingle();
    const { data, error } = await (context.supabase.rpc("cancel_task_rectification" as any, {
        p_request_id: requestId,
        p_actor_user_client_instance_id: context.instanceId,
    } as any) as any);
    if (error) return { error: messageFromError(error, "Could not cancel rectification request") };
    const request = (Array.isArray(data) ? data[0] : data) as RectificationRequest;
    await deleteTaskProof(request.task_id, "rectification_cancelled");
    await notifyHumanRequest((existing || request) as RectificationRequest, "CANCELLED");
    refreshRectificationViews(request.task_id);
    return { success: true, request };
}

export async function askForRectificationProof(requestId: string) {
    const context = await actorContext();
    if (!("supabase" in context)) return context;
    const { data, error } = await (context.supabase.rpc("request_rectification_proof" as any, {
        p_request_id: requestId,
        p_actor_user_client_instance_id: context.instanceId,
    } as any) as any);
    if (error) return { error: messageFromError(error, "Could not request proof") };
    const request = (Array.isArray(data) ? data[0] : data) as RectificationRequest;
    const task = await taskNotificationContext(request.task_id);
    await sendNotification({
        userId: request.owner_id,
        title: "Proof requested",
        text: `Your voucher asked for proof for “${task?.title || "your task"}”. The rectification deadline is unchanged.`,
        url: `/tasks/${request.task_id}`,
        tag: `rectification-${request.id}-proof-requested`,
        data: { kind: "RECTIFICATION_PROOF_REQUESTED", taskId: request.task_id, requestId: request.id },
        email: false,
    });
    refreshRectificationViews(request.task_id);
    return { success: true, request };
}

export async function decideTaskRectification(requestId: string, decision: "APPROVE" | "DECLINE", reason?: string | null) {
    const context = await actorContext();
    if (!("supabase" in context)) return context;
    const { data: existing } = await (context.supabase.from("rectification_requests") as any)
        .select("*").eq("id", requestId).maybeSingle();
    if (!existing) return { error: "Rectification request not found" };
    const { error } = await (context.supabase.rpc("decide_task_rectification" as any, {
        p_request_id: requestId,
        p_decision: decision,
        p_reason: reason ?? null,
        p_actor_user_client_instance_id: context.instanceId,
    } as any) as any);
    if (error) return { error: messageFromError(error, "Could not resolve rectification request") };
    await postResolutionEffects(existing as RectificationRequest, decision === "APPROVE" ? "APPROVED" : "DECLINED", reason);
    return { success: true };
}

export async function appealAiRectification(requestId: string, reason?: string | null) {
    const context = await actorContext();
    if (!("supabase" in context)) return context;
    const { data, error } = await (context.supabase.rpc("submit_rectification_ai_appeal" as any, {
        p_request_id: requestId,
        p_reason: reason ?? null,
        p_actor_user_client_instance_id: context.instanceId,
    } as any) as any);
    if (error) return { error: messageFromError(error, "Could not submit AI appeal") };
    const request = (Array.isArray(data) ? data[0] : data) as RectificationRequest;
    const { queueAiRectificationEvaluation } = await import("@/lib/ai-voucher/rectification");
    await queueAiRectificationEvaluation(request.id);
    refreshRectificationViews(request.task_id);
    return { success: true, request };
}

export async function escalateRectificationToOriginalVoucher(requestId: string) {
    const context = await actorContext();
    if (!("supabase" in context)) return context;
    const { data, error } = await (context.supabase.rpc("escalate_rectification_to_original_voucher" as any, {
        p_request_id: requestId,
        p_actor_user_client_instance_id: context.instanceId,
    } as any) as any);
    if (error) return { error: messageFromError(error, "Could not escalate rectification request") };
    const request = (Array.isArray(data) ? data[0] : data) as RectificationRequest;
    await notifyHumanRequest(request, "REQUESTED");
    refreshRectificationViews(request.task_id);
    return { success: true, request };
}

export async function notifyRectificationProofUploaded(requestId: string) {
    const context = await actorContext();
    if (!("supabase" in context)) return context;
    const { data } = await (context.supabase.from("rectification_requests") as any)
        .select("*").eq("id", requestId).eq("owner_id", context.user.id).maybeSingle();
    if (!data) return { error: "Rectification request not found" };
    const request = data as RectificationRequest;
    if (request.target_type === "AI") {
        const { queueAiRectificationEvaluation } = await import("@/lib/ai-voucher/rectification");
        await queueAiRectificationEvaluation(request.id);
    } else {
        await notifyHumanRequest(request, "PROOF_UPLOADED");
    }
    return { success: true };
}
