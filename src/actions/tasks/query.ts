"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SYSTEM_ACTOR_PROFILE_ID } from "@/lib/system-actor";
import { invalidateActiveTasksCache, enqueueGoogleCalendarUpsert } from "./helpers";
import { revalidatePath } from "next/cache";

export async function getTask(taskId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    // @ts-ignore
    const { data: task } = await (supabase.from("tasks") as any)
        .select(`
      *,
      user:profiles!tasks_user_id_fkey(*),
      voucher:profiles!tasks_voucher_id_fkey(*),
      recurrence_rule:recurrence_rules(*)
    `)
        .eq("id", (taskId as any))
        .single();

    if (task) {
        const isOwner = (task as any).user_id === user.id;
        const isVoucher = (task as any).voucher_id === user.id;
        const isActiveTask = ["ACTIVE", "POSTPONED"].includes((task as any).status);
        const ownerAllowsVoucherActiveView = (task as any).user?.voucher_can_view_active_tasks === true;
        const voucherActiveViewBlocked = isVoucher && !isOwner && isActiveTask && !ownerAllowsVoucherActiveView;

        if (voucherActiveViewBlocked) {
            return null;
        }

        if (isOwner || isVoucher) {
            const now = new Date();
            const deadline = new Date((task as any).deadline);
            const shouldAutoFail =
                now >= deadline &&
                ["ACTIVE", "POSTPONED"].includes((task as any).status);

            if (shouldAutoFail) {
                const currentPeriod = now.toISOString().slice(0, 7);
                const nowIso = now.toISOString();
                const admin = createAdminClient();

                const { data: claimedRows, error: claimError } = await (admin.from("tasks") as any)
                    .update({ status: "MISSED", updated_at: nowIso } as any)
                    .eq("id", (taskId as any))
                    .in("status", ["ACTIVE", "POSTPONED"] as any)
                    .select("id");

                if (claimError) {
                    console.error("Failed to claim task for MISSED transition in getTask:", claimError);
                }

                const didClaim = Array.isArray(claimedRows) && claimedRows.length > 0;
                if (didClaim) {
                    const { error: ledgerInsertError } = await (admin.from("ledger_entries") as any).insert({
                        user_id: (task as any).user_id,
                        task_id: (task as any).id,
                        period: currentPeriod,
                        amount_cents: (task as any).failure_cost_cents,
                        entry_type: "failure",
                    });
                    if (ledgerInsertError) {
                        console.error("Failed to insert MISSED ledger entry in getTask:", ledgerInsertError);
                    }

                    const { error: deadlineEventError } = await (admin.from("task_events") as any).insert({
                        task_id: (task as any).id,
                        event_type: "DEADLINE_MISSED",
                        actor_id: SYSTEM_ACTOR_PROFILE_ID,
                        from_status: (task as any).status,
                        to_status: "MISSED",
                        metadata: { reason: "Deadline passed without completion" },
                    });
                    if (deadlineEventError && deadlineEventError.code !== "23505") {
                        console.error("Failed to log DEADLINE_MISSED event:", deadlineEventError);
                    }

                    await enqueueGoogleCalendarUpsert((task as any).user_id, taskId);

                    (task as any).status = "MISSED";
                    (task as any).updated_at = nowIso;

                    invalidateActiveTasksCache((task as any).user_id);
                    revalidatePath(`/tasks/${taskId}`);
                }
            }
        }

        if (isOwner || isVoucher) {
            (task as any).commitment_proof_required = false;
        }

        if (isOwner) {
            const [{ data: subtasks }, { data: reminders }] = await Promise.all([
                (supabase.from("task_subtasks") as any)
                    .select("*")
                    .eq("parent_task_id", taskId as any)
                    .eq("user_id", user.id as any)
                    .order("created_at", { ascending: true }),
                (supabase.from("task_reminders") as any)
                    .select("*")
                    .eq("parent_task_id", taskId as any)
                    .eq("user_id", user.id as any)
                    .order("reminder_at", { ascending: true }),
            ]);

            (task as any).subtasks = (subtasks as any[]) || [];
            (task as any).reminders = (reminders as any[]) || [];
        }

        if (isOwner || isVoucher) {
            const supabaseAdmin = createAdminClient();
            const [{ data: proof }, { data: googleLink, error: googleLinkError }, { data: denials }] = await Promise.all([
                (supabase.from("task_completion_proofs") as any)
                    .select("*")
                    .eq("task_id", taskId as any)
                    .maybeSingle(),
                (supabaseAdmin.from("google_calendar_task_links") as any)
                    .select("last_origin")
                    .eq("task_id", taskId as any)
                    .eq("user_id", (task as any).user_id as any)
                    .maybeSingle(),
                (supabaseAdmin.from("ai_vouches") as any)
                    .select("*")
                    .eq("task_id", taskId as any)
                    .order("attempt_number", { ascending: true }),
            ]);

            if (googleLinkError) {
                console.error("Failed to load Google sync link for task detail:", googleLinkError);
            }

            const rawLastOrigin = (googleLink as any)?.last_origin;
            const lastOrigin =
                rawLastOrigin === "APP" || rawLastOrigin === "GOOGLE"
                    ? rawLastOrigin
                    : null;

            (task as any).completion_proof = proof || null;
            (task as any).google_sync_linked = Boolean(googleLink);
            (task as any).google_sync_last_origin = lastOrigin;
            (task as any).ai_vouches = (denials as any[]) || [];
        }

        if (isOwner || isVoucher) {
            return task;
        }
    }

    return null;
}

export async function getTaskEvents(taskId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data: task } = await (supabase.from("tasks") as any)
        .select("user_id, voucher_id")
        .eq("id", taskId as any)
        .single();

    if (!task || (task.user_id !== user.id && task.voucher_id !== user.id)) {
        return [];
    }

    const { data: events } = await (supabase.from("task_events") as any)
        .select("*")
        .eq("task_id", taskId as any)
        .order("created_at", { ascending: true });

    return (events as any) || [];
}

export async function getTaskPomoSummary(taskId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    // @ts-ignore
    const { data: task } = await (supabase.from("tasks") as any)
        .select("id, user_id, voucher_id, status, user:profiles!tasks_user_id_fkey(voucher_can_view_active_tasks)")
        .eq("id", taskId as any)
        .single();

    if (!task) return null;

    const canView = task.user_id === user.id || task.voucher_id === user.id;
    if (!canView) return null;
    const isVoucher = task.voucher_id === user.id;
    const isOwner = task.user_id === user.id;
    const isActiveTask = ["ACTIVE", "POSTPONED"].includes((task as any).status);
    const ownerAllowsVoucherActiveView = (task as any).user?.voucher_can_view_active_tasks === true;
    if (isVoucher && !isOwner && isActiveTask && !ownerAllowsVoucherActiveView) return null;

    // @ts-ignore
    const { data: sessions } = await (supabase.from("pomo_sessions") as any)
        .select("elapsed_seconds, status, completed_at")
        .eq("task_id", taskId as any)
        .eq("user_id", task.user_id as any)
        .neq("status", "DELETED")
        .order("created_at", { ascending: false });

    const rows = (sessions as any[]) || [];
    const totalSeconds = rows.reduce((sum, s) => sum + (s.elapsed_seconds || 0), 0);
    const completedSessions = rows.filter((s) => s.status === "COMPLETED").length;
    const lastCompletedAt = rows.find((s) => s.status === "COMPLETED" && s.completed_at)?.completed_at || null;

    return {
        totalSeconds,
        sessionCount: rows.length,
        completedSessions,
        lastCompletedAt,
    };
}
