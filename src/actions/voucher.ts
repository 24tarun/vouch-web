"use server";

import { revalidatePath, unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canTransition, type TaskStatus } from "@/lib/xstate/task-machine";
import { sendNotification } from "@/lib/notifications";
import { type Database, type VoucherPendingTask } from "@/lib/types";
import { type SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
    pendingVoucherRequestsTag,
    invalidateActiveTasksCache,
    invalidatePendingVoucherRequestsCache,
} from "@/lib/cache-tags";
import { deleteTaskProof } from "@/lib/task-proof";
import { enqueueGoogleCalendarOutbox } from "@/lib/google-calendar/sync";
import { canVoucherSeeTask } from "@/lib/voucher-task-visibility";
import { buildProofRequestCountByTaskId, type ProofRequestEventRow } from "@/lib/voucher-proof-request";
import { sortPendingTasks } from "@/lib/voucher-pending-sort";
import { resolveWebUserClientInstanceId } from "@/lib/user-client-instance";
import {
    notifyCommitmentFailureIfNeeded,
    notifyCommitmentRevivedIfNeeded,
} from "@/actions/commitments";
import { revalidateTaskAndSocialSurfaces } from "@/actions/tasks/helpers";

async function enqueueGoogleCalendarUpsert(userId: string, taskId: string) {
    try {
        await enqueueGoogleCalendarOutbox(userId, taskId, "UPSERT");
    } catch (error) {
        console.error(`Failed to enqueue Google Calendar UPSERT for task ${taskId}:`, error);
    }
}

const ACTIVE_PENDING_STATUSES: TaskStatus[] = ["ACTIVE", "POSTPONED"];
const AWAITING_PENDING_STATUSES: TaskStatus[] = ["AWAITING_VOUCHER", "MARKED_COMPLETE"];
const PENDING_VOUCH_REQUEST_STATUSES: TaskStatus[] = [
    ...ACTIVE_PENDING_STATUSES,
    ...AWAITING_PENDING_STATUSES,
];
const ACTIVE_PENDING_STATUS_SET = new Set<TaskStatus>(ACTIVE_PENDING_STATUSES);
const RECTIFY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type VoucherDecisionTask = {
    id: string;
    user_id: string;
    voucher_id: string;
    title?: string;
    failure_cost_cents: number;
    recurrence_rule_id?: string | null;
    status: TaskStatus;
    user?: { id?: string; email?: string | null; username?: string | null } | null;
};


function deriveAwaitingDeadline(task: { voucher_response_deadline: string | null; marked_completed_at: string | null }): string | null {
    if (task.voucher_response_deadline) return task.voucher_response_deadline;
    if (!task.marked_completed_at) return null;

    const derived = new Date(task.marked_completed_at);
    if (Number.isNaN(derived.getTime())) return null;
    derived.setDate(derived.getDate() + 2);
    derived.setHours(23, 59, 59, 999);
    return derived.toISOString();
}

function getPendingDisplayType(status: TaskStatus): VoucherPendingTask["pending_display_type"] {
    return ACTIVE_PENDING_STATUS_SET.has(status) ? "ACTIVE" : "AWAITING_VOUCHER";
}

function getPendingDeadline(task: {
    status: TaskStatus;
    deadline: string;
    voucher_response_deadline: string | null;
    marked_completed_at: string | null;
}): string | null {
    return ACTIVE_PENDING_STATUS_SET.has(task.status)
        ? (task.deadline || null)
        : deriveAwaitingDeadline(task);
}

async function applyVoucherDecisionUpdate(
    supabase: SupabaseClient<Database>,
    taskId: string,
    voucherId: string,
    priorStatus: TaskStatus,
    patch: Record<string, unknown>
) {
    const { data: updatedRows, error } = await (supabase.from("tasks") as any)
        .update(patch as any)
        .eq("id", taskId as any)
        .eq("voucher_id", voucherId as any)
        .eq("status", priorStatus as any)
        .select("id");

    if (error) return { error: error.message };
    if (!updatedRows || updatedRows.length === 0) {
        return { error: "Task is no longer awaiting voucher response." };
    }
    return { success: true as const };
}

function refreshVoucherDecisionSurfaces(taskId: string, ownerUserId: string, voucherId: string) {
    revalidateTaskAndSocialSurfaces(taskId, ownerUserId, voucherId);
}

export async function voucherAccept(taskId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    // @ts-ignore
    const { data: task } = await (supabase.from("tasks") as any)
        .select("*, user:profiles!tasks_user_id_fkey(id, email, username)")
        .eq("id", (taskId as any))
        .eq("voucher_id", (user as any).id)
        .single();

    if (!task) {
        return { error: "Task not found or you are not the voucher" };
    }
    const typedTask = task as VoucherDecisionTask;

    if (!canTransition(typedTask.status, "VOUCHER_ACCEPT")) {
        return { error: `Cannot accept task in ${typedTask.status} status` };
    }

    const cleanup = await deleteTaskProof(taskId, "voucher_accept");
    if (!cleanup.success) {
        return { error: cleanup.error || "Could not remove proof media." };
    }

    const priorStatus = typedTask.status;
    const updateResult = await applyVoucherDecisionUpdate(
        supabase,
        taskId,
        user.id,
        priorStatus,
        {
            status: "ACCEPTED",
            has_proof: cleanup.deleted,
            proof_request_open: false,
            proof_requested_at: null,
            proof_requested_by: null,
        }
    );
    if ("error" in updateResult) return { error: updateResult.error };

    // @ts-ignore
    await supabase.from("task_events").insert({
        task_id: taskId as any,
        event_type: "VOUCHER_ACCEPT",
        actor_id: (user as any).id,
        actor_user_client_instance_id: await resolveWebUserClientInstanceId(user.id),
        from_status: priorStatus,
        to_status: "ACCEPTED",
    });

    await enqueueGoogleCalendarUpsert(typedTask.user_id, taskId);

    // Owner dashboard active tasks are cached via getCachedActiveTasksForUser(activeTasksTag).
    // Voucher decisions mutate owner-visible task state, so invalidate owner tags in addition
    // to path revalidation and realtime-triggered refresh to avoid stale server payloads.
    refreshVoucherDecisionSurfaces(taskId, typedTask.user_id, user.id);
    return { success: true };
}

export async function voucherDeny(taskId: string) {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    // @ts-ignore
    const { data: task } = await (supabase.from("tasks") as any)
        .select("*, user:profiles!tasks_user_id_fkey(id, email, username)")
        .eq("id", (taskId as any))
        .eq("voucher_id", (user as any).id)
        .single();

    if (!task) {
        return { error: "Task not found or you are not the voucher" };
    }
    const typedTask = task as VoucherDecisionTask;

    if (!canTransition(typedTask.status, "VOUCHER_DENY")) {
        return { error: `Cannot deny task in ${typedTask.status} status` };
    }

    const cleanup = await deleteTaskProof(taskId, "voucher_deny");
    if (!cleanup.success) {
        return { error: cleanup.error || "Could not remove proof media." };
    }

    // Add to ledger
    const currentPeriod = new Date().toISOString().slice(0, 7);
    const priorStatus = typedTask.status;
    const updateResult = await applyVoucherDecisionUpdate(
        supabase,
        taskId,
        user.id,
        priorStatus,
        {
            status: "DENIED",
            proof_request_open: false,
            proof_requested_at: null,
            proof_requested_by: null,
        }
    );
    if ("error" in updateResult) return { error: updateResult.error };

    // Create ledger entry (use admin client to bypass RLS — voucher's auth.uid() ≠ task owner)
    const adminForLedger = createAdminClient();
    const { error: ledgerError } = await (adminForLedger.from("ledger_entries" as any) as any).insert({
        user_id: (task as any).user_id,
        task_id: taskId as any,
        period: currentPeriod,
        amount_cents: (task as any).failure_cost_cents,
        entry_type: "failure",
    });
    if (ledgerError) {
        console.error(`[voucherDeny] Failed to insert ledger entry for task ${taskId}:`, ledgerError);
    }

    // @ts-ignore
    await (supabase.from("task_events") as any).insert({
        task_id: taskId as any,
        event_type: "VOUCHER_DENY",
        actor_id: (user as any).id,
        actor_user_client_instance_id: await resolveWebUserClientInstanceId(user.id),
        from_status: priorStatus,
        to_status: "DENIED",
    });

    await enqueueGoogleCalendarUpsert(typedTask.user_id, taskId);

    if (typedTask.user?.id) {
        await sendNotification({
            userId: typedTask.user.id,
            title: "Task denied",
            text: `Your voucher denied "${typedTask.title}". Failure cost applied.`,
            email: false,
            push: true,
            url: `/tasks/${taskId}`,
            tag: `task-denied-${taskId}`,
            data: { taskId, kind: "TASK_DENIED" },
        });
    }

    await notifyCommitmentFailureIfNeeded(taskId, typedTask.recurrence_rule_id ?? null);

    // Owner dashboard active tasks are cached via getCachedActiveTasksForUser(activeTasksTag).
    // Voucher decisions mutate owner-visible task state, so invalidate owner tags in addition
    // to path revalidation and realtime-triggered refresh to avoid stale server payloads.
    refreshVoucherDecisionSurfaces(taskId, typedTask.user_id, user.id);
    return { success: true };
}

export async function voucherRequestProof(taskId: string) {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const { data: task } = await (supabase.from("tasks") as any)
        .select("id, title, status, user_id, voucher_id, user:profiles!tasks_user_id_fkey(id, email, username)")
        .eq("id", taskId as any)
        .eq("voucher_id", user.id as any)
        .single();

    if (!task) {
        return { error: "Task not found or you are not the voucher" };
    }

    if ((task as any).voucher_id === (task as any).user_id) {
        return { error: "Self-vouched tasks do not support proof requests." };
    }

    if ((task as any).status !== "AWAITING_VOUCHER" && (task as any).status !== "MARKED_COMPLETE") {
        return { error: `Cannot request proof in ${(task as any).status} status` };
    }

    const nowIso = new Date().toISOString();
    const { data: updatedRows, error: updateError } = await (supabase.from("tasks") as any)
        .update({
            proof_request_open: true,
            proof_requested_at: nowIso,
            proof_requested_by: user.id,
            updated_at: nowIso,
        } as any)
        .eq("id", taskId as any)
        .eq("voucher_id", user.id as any)
        .in("status", ["AWAITING_VOUCHER", "MARKED_COMPLETE"] as any)
        .select("id");

    if (updateError) {
        return { error: updateError.message };
    }
    if (!updatedRows || updatedRows.length === 0) {
        return { error: "Task is no longer awaiting voucher response." };
    }

    await (supabase.from("task_events") as any).insert({
        task_id: taskId as any,
        event_type: "PROOF_REQUESTED",
        actor_id: user.id as any,
        actor_user_client_instance_id: await resolveWebUserClientInstanceId(user.id),
        from_status: (task as any).status,
        to_status: (task as any).status,
    });

    const owner = (task as any).user as { id?: string; email?: string | null; username?: string | null } | null;
    if (owner?.id) {
        const { data: voucherProfile } = await supabase
            .from("profiles")
            .select("username")
            .eq("id", user.id as any)
            .maybeSingle();
        const voucherDisplayName = (voucherProfile as { username?: string | null } | null)?.username || "Your voucher";

        await sendNotification({
            userId: owner.id,
            title: "Proof requested",
            text: `${voucherDisplayName} has asked for proof for "${(task as any).title}".`,
            email: false,
            push: true,
            url: `/tasks/${taskId}`,
            tag: `proof-request-${taskId}`,
            data: { taskId, kind: "PROOF_REQUESTED" },
        });
    }

    // Owner dashboard active tasks are cached via getCachedActiveTasksForUser(activeTasksTag).
    // Voucher decisions mutate owner-visible task state, so invalidate owner tags in addition
    // to path revalidation and realtime-triggered refresh to avoid stale server payloads.
    revalidateTaskAndSocialSurfaces(taskId, (task as any).user_id, user.id);
    return { success: true };
}

export async function authorizeRectify(taskId: string) {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    // @ts-ignore
    const { data: task } = await (supabase.from("tasks") as any)
        .select("*")
        .eq("id", (taskId as any))
        .eq("voucher_id", (user as any).id)
        .single();

    if (!task) {
        return { error: "Task not found or you are not the voucher" };
    }

    if (!canTransition((task as any).status as TaskStatus, "RECTIFY")) {
        return { error: `Cannot rectify task in ${(task as any).status} status` };
    }

    // Check rectify window: task must have failed within the last 7 days.
    const currentPeriod = new Date().toISOString().slice(0, 7);
    const failedAtMs = new Date((task as any).updated_at).getTime();
    if (!Number.isFinite(failedAtMs)) {
        return { error: "Task failure timestamp is invalid." };
    }
    if ((Date.now() - failedAtMs) > RECTIFY_WINDOW_MS) {
        return { error: "Rectify window expired (more than 7 days since failure)." };
    }
    const { count } = await supabase
        .from("rectify_passes" as any)
        .select("*", { count: "exact", head: true })
        .eq("user_id", (task as any).user_id)
        .eq("period", currentPeriod);

    if ((count || 0) >= 5) {
        return { error: "User has already used all 5 rectify passes this month" };
    }

    // Update task
    const priorStatus = (task as any).status as TaskStatus;
    const { data: updatedRows, error } = await (supabase.from("tasks") as any)
        .update({ status: "RECTIFIED" } as any)
        .eq("id", (taskId as any))
        .eq("voucher_id", user.id)
        .eq("status", priorStatus as any)
        .select("id");

    if (error) {
        return { error: error.message };
    }
    if (!updatedRows || updatedRows.length === 0) {
        return { error: "Task is no longer eligible for rectify." };
    }

    // Create rectify pass record
    await (supabase.from("rectify_passes" as any) as any).insert({
        user_id: (task as any).user_id,
        task_id: (taskId as any),
        authorized_by: (user as any).id,
        period: currentPeriod,
    });

    // Create negative ledger entry to cancel out the failure
    // Use admin client to bypass RLS — voucher's auth.uid() ≠ task owner
    const adminForLedgerRectify = createAdminClient();
    const { error: rectifyLedgerError } = await (adminForLedgerRectify.from("ledger_entries" as any) as any).insert({
        user_id: (task as any).user_id,
        task_id: (taskId as any),
        period: currentPeriod,
        amount_cents: -(task as any).failure_cost_cents,
        entry_type: "rectified",
    });
    if (rectifyLedgerError) {
        console.error(`[authorizeRectify] Failed to insert ledger entry for task ${taskId}:`, rectifyLedgerError);
    }

    // @ts-ignore
    await (supabase.from("task_events") as any).insert({
        task_id: (taskId as any),
        event_type: "RECTIFY",
        actor_id: (user as any).id,
        actor_user_client_instance_id: await resolveWebUserClientInstanceId(user.id),
        from_status: priorStatus,
        to_status: "RECTIFIED",
    });

    await enqueueGoogleCalendarUpsert((task as any).user_id, taskId);
    await notifyCommitmentRevivedIfNeeded(taskId, (task as any).recurrence_rule_id ?? null);

    revalidatePath("/friends");
    revalidatePath("/commit");
    revalidatePath(`/tasks/${taskId}`);
    return { success: true };
}

export async function getCachedPendingVouchRequestsForVoucher(voucherId: string): Promise<VoucherPendingTask[]> {
    if (!voucherId) return [];

    const loadPendingRequests = unstable_cache(
        async () => {
            const supabaseAdmin = createAdminClient();
            // @ts-ignore
            const { data: tasks } = await (supabaseAdmin.from("tasks") as any)
                .select(`
                    id,
                    user_id,
                    voucher_id,
                    title,
                    description,
                    deadline,
                    status,
                    marked_completed_at,
                    voucher_response_deadline,
                    failure_cost_cents,
                    requires_proof,
                    recurrence_rule_id,
                    created_at,
                    updated_at,
                    google_sync_for_task,
                    google_event_start_at,
                    google_event_end_at,
                    google_event_color_id,
                    has_proof,
                    proof_request_open,
                    proof_requested_at,
                    proof_requested_by,
                    user:profiles!tasks_user_id_fkey(id, username, voucher_can_view_active_tasks)
                `)
                .eq("voucher_id", voucherId as any)
                .neq("user_id", voucherId as any)
                .in("status", PENDING_VOUCH_REQUEST_STATUSES as any)
                .order("updated_at", { ascending: false });

            const pendingTasks = ((tasks as any[]) || []).filter((task) =>
                canVoucherSeeTask({
                    status: task.status as TaskStatus,
                    deadline: task.deadline,
                    user: task.user as { voucher_can_view_active_tasks?: boolean } | null,
                })
            );
            if (pendingTasks.length === 0) return [];

            const taskIds = pendingTasks.map((task) => task.id);
            const ownerIds = [...new Set(pendingTasks.map((task) => task.user_id))];

            const [{ data: sessions }, { data: proofs }, { data: proofEvents }] = await Promise.all([
                // @ts-ignore
                (supabaseAdmin.from("pomo_sessions") as any)
                    .select("task_id, elapsed_seconds")
                    .in("task_id", taskIds as any)
                    .in("user_id", ownerIds as any)
                    .neq("status", "DELETED"),
                // @ts-ignore
                (supabaseAdmin.from("task_completion_proofs") as any)
                    .select("task_id, media_kind, mime_type, size_bytes, duration_ms, overlay_timestamp_text, upload_state, updated_at")
                    .in("task_id", taskIds as any)
                    .eq("upload_state", "UPLOADED"),
                // @ts-ignore
                (supabaseAdmin.from("task_events") as any)
                    .select("task_id")
                    .in("task_id", taskIds as any)
                    .eq("event_type", "PROOF_REQUESTED"),
            ]);

            const secondsByTask = new Map<string, number>();
            for (const row of (sessions as any[]) || []) {
                const key = row.task_id as string;
                const total = secondsByTask.get(key) || 0;
                secondsByTask.set(key, total + (row.elapsed_seconds || 0));
            }

            const proofByTask = new Map<string, any>();
            for (const row of (proofs as any[]) || []) {
                proofByTask.set(row.task_id as string, row);
            }
            const proofRequestCountsByTask = buildProofRequestCountByTaskId((proofEvents as ProofRequestEventRow[]) || []);

            const normalizedTasks = pendingTasks.map((task) => ({
                ...task,
                pomo_total_seconds: secondsByTask.get(task.id) || 0,
                completion_proof: proofByTask.get(task.id) || null,
                pending_display_type: getPendingDisplayType(task.status as TaskStatus),
                pending_deadline_at: getPendingDeadline({
                    status: task.status as TaskStatus,
                    deadline: task.deadline,
                    voucher_response_deadline: task.voucher_response_deadline,
                    marked_completed_at: task.marked_completed_at,
                }),
                pending_actionable: (task.status as TaskStatus) === "AWAITING_VOUCHER",
                proof_request_count: proofRequestCountsByTask.get(task.id) || 0,
            })) as VoucherPendingTask[];

            return sortPendingTasks(normalizedTasks);
        },
        ["pending-vouch-requests", voucherId],
        {
            tags: [pendingVoucherRequestsTag(voucherId)],
            revalidate: 300,
        }
    );

    return loadPendingRequests();
}

export async function getPendingVouchRequests(): Promise<VoucherPendingTask[]> {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return [];

    return getCachedPendingVouchRequestsForVoucher(user.id);
}

const FINAL_HISTORY_STATUSES = ["ACCEPTED", "AUTO_ACCEPTED", "AI_ACCEPTED", "DENIED", "MISSED", "RECTIFIED", "SETTLED", "DELETED"];

export async function getVouchHistoryPage(offsetInput: number, limitInput: number) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { tasks: [], hasMore: false, nextOffset: 0, error: "Not authenticated" };
    }

    const offset = Number.isFinite(offsetInput) ? Math.max(0, Math.floor(offsetInput)) : 0;
    const normalizedLimitRaw = Number.isFinite(limitInput) ? Math.floor(limitInput) : 10;
    const limit = Math.min(50, Math.max(1, normalizedLimitRaw));

    // Fetch one extra row to determine if there is another page.
    const rangeFrom = offset;
    const rangeTo = offset + limit;

    // @ts-ignore
    const { data: rawTasks, error } = await (supabase.from("tasks") as any)
        .select(`
            *,
            user:profiles!tasks_user_id_fkey(*)
        `)
        .eq("voucher_id", (user as any).id)
        .neq("user_id", (user as any).id)
        .in("status", FINAL_HISTORY_STATUSES)
        .order("updated_at", { ascending: false })
        .range(rangeFrom, rangeTo);

    if (error) {
        return { tasks: [], hasMore: false, nextOffset: offset, error: error.message };
    }

    const pagedRows = (rawTasks as any[]) || [];
    const hasMore = pagedRows.length > limit;
    const visibleRows = hasMore ? pagedRows.slice(0, limit) : pagedRows;

    if (visibleRows.length === 0) {
        return { tasks: [], hasMore: false, nextOffset: offset };
    }

    const currentPeriod = new Date().toISOString().slice(0, 7);
    const ownerIds = [...new Set(visibleRows.map((task) => task.user_id as string).filter(Boolean))];

    const ownerCountEntries = await Promise.all(ownerIds.map(async (ownerId) => {
        const { count } = await supabase
            .from("rectify_passes" as any)
            .select("*", { count: "exact", head: true })
            .eq("user_id", ownerId as any)
            .eq("period", currentPeriod);

        return [ownerId, count || 0] as const;
    }));

    const countsByOwner = new Map<string, number>(ownerCountEntries);
    const tasks = visibleRows.map((task) => ({
        ...task,
        rectify_passes_used: countsByOwner.get(task.user_id) || 0,
    }));

    return {
        tasks,
        hasMore,
        nextOffset: offset + tasks.length,
    };
}

/**
 * Escalate an AI-denied task to a human voucher for a second opinion.
 * The task must be in AWAITING_USER status and originally AI-vouched.
 * No penalty is charged at AI denial stage; penalty is charged only on ACCEPT_DENIAL.
 * Sets ai_escalated_from = true so the 0.5× weight applies even if human approves.
 */
export async function escalateToHumanVoucher(
    taskId: string,
    newVoucherId: string
): Promise<{ success?: boolean; error?: string }> {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    // Fetch the task
    // @ts-ignore
    const { data: task } = await (supabase.from("tasks") as any)
        .select("*, user:profiles!tasks_user_id_fkey(id, email, username)")
        .eq("id", (taskId as any))
        .eq("user_id", (user as any).id)
        .single();

    if (!task) {
        return { error: "Task not found" };
    }

    // Verify preconditions — escalation only from AWAITING_USER
    if ((task as any).status !== "AWAITING_USER") {
        return { error: `Cannot escalate task in ${(task as any).status} status` };
    }

    // Check that the task is currently AI-vouched and has not already been escalated.
    const { AI_PROFILE_ID } = await import("@/lib/ai-voucher/constants");
    if ((task as any).voucher_id !== AI_PROFILE_ID || Boolean((task as any).ai_escalated_from)) {
        return { error: "This task was not AI-vouched and cannot be escalated" };
    }

    // Escalation is friend-only; AI is disabled in the picker
    if (newVoucherId === AI_PROFILE_ID) {
        return { error: "Cannot escalate to AI. Choose a friend." };
    }

    if (newVoucherId === user.id) {
        return { error: "Cannot escalate to yourself. Choose a friend." };
    }

    // Validate new voucher is a friend.
    const { data: friendship } = await (supabase.from("friendships") as any)
        .select("friend_id")
        .eq("user_id", (user as any).id)
        .eq("friend_id", (newVoucherId as any))
        .maybeSingle();
    if (!friendship) {
        return { error: "New voucher must be a friend" };
    }

    // Fetch new voucher's profile for notification
    const { data: newVoucher } = await (supabase.from("profiles") as any)
        .select("id, email, username")
        .eq("id", (newVoucherId as any))
        .maybeSingle();

    // Change voucher to human, set ai_escalated_from flag, transition through ESCALATED to AWAITING_VOUCHER
    // @ts-ignore
    const { error: updateError } = await (supabase.from("tasks") as any)
        .update({
            voucher_id: (newVoucherId as any),
            ai_escalated_from: true,
            status: "AWAITING_VOUCHER" as any,
            voucher_response_deadline: getVoucherResponseDeadline(),
        } as any)
        .eq("id", (taskId as any))
        .eq("user_id", (user as any).id);

    if (updateError) {
        return { error: updateError.message };
    }

    // No ledger reversal needed — no penalty was charged at AI denial stage

    // Write ESCALATED transitional event, then auto-hop to AWAITING_VOUCHER
    await (supabase.from("task_events") as any).insert([
        {
            task_id: (taskId as any),
            event_type: "ESCALATE",
            actor_id: (user as any).id,
            actor_user_client_instance_id: await resolveWebUserClientInstanceId(user.id),
            from_status: (task as any).status,
            to_status: "ESCALATED",
            metadata: { new_voucher_id: (newVoucherId as any) },
        },
        {
            task_id: (taskId as any),
            event_type: "AI_ESCALATE_TO_HUMAN",
            actor_id: (user as any).id,
            actor_user_client_instance_id: await resolveWebUserClientInstanceId(user.id),
            from_status: "ESCALATED",
            to_status: "AWAITING_VOUCHER",
            metadata: { new_voucher_id: (newVoucherId as any) },
        },
    ]);

    // Notify the new voucher
    if (newVoucherId) {
        await sendNotification({
            userId: (newVoucherId as any),
            title: "Task escalated to you",
            text: `${(task as any).user?.username || "A friend"} is appealing AI's denial of "${(task as any).title}".`,
            email: false,
            push: true,
            url: "/voucher",
            tag: `task-escalated-${taskId}`,
            data: { taskId, kind: "TASK_ESCALATED_TO_VOUCHER" },
        });
    }

    // Invalidate caches
    invalidateActiveTasksCache((task as any).user_id);
    invalidatePendingVoucherRequestsCache((newVoucherId as any));
    revalidatePath("/tasks");
    revalidatePath("/voucher");
    revalidatePath(`/tasks/${taskId}`);

    return { success: true };
}

function getVoucherResponseDeadline(): string {
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 2);
    deadline.setHours(23, 59, 59, 999);
    return deadline.toISOString();
}
