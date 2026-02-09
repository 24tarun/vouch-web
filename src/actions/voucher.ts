"use server";

import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canTransition, type TaskStatus } from "@/lib/xstate/task-machine";
import { sendNotification } from "@/lib/notifications";
import { type Database, type VoucherPendingTask } from "@/lib/types";
import { type SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { pendingVoucherRequestsTag } from "@/lib/cache-tags";
import { deleteTaskProof } from "@/lib/task-proof";

function invalidatePendingVoucherRequestsCache(voucherId: string) {
    revalidateTag(pendingVoucherRequestsTag(voucherId), "max");
}

const RECTIFY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_PENDING_STATUSES: TaskStatus[] = ["CREATED", "POSTPONED"];
const AWAITING_PENDING_STATUSES: TaskStatus[] = ["AWAITING_VOUCHER", "MARKED_COMPLETED"];
const PENDING_VOUCH_REQUEST_STATUSES: TaskStatus[] = [
    ...ACTIVE_PENDING_STATUSES,
    ...AWAITING_PENDING_STATUSES,
];
const ACTIVE_PENDING_STATUS_SET = new Set<TaskStatus>(ACTIVE_PENDING_STATUSES);

function parseTimestamp(value: string | null | undefined): number | null {
    if (!value) return null;
    const ts = new Date(value).getTime();
    return Number.isNaN(ts) ? null : ts;
}

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

function sortPendingTasks(tasks: VoucherPendingTask[]): VoucherPendingTask[] {
    return [...tasks].sort((a, b) => {
        const aDeadlineTs = parseTimestamp(a.pending_deadline_at);
        const bDeadlineTs = parseTimestamp(b.pending_deadline_at);

        if (aDeadlineTs === null && bDeadlineTs === null) {
            const aUpdatedTs = parseTimestamp(a.updated_at) || 0;
            const bUpdatedTs = parseTimestamp(b.updated_at) || 0;
            return bUpdatedTs - aUpdatedTs;
        }
        if (aDeadlineTs === null) return 1;
        if (bDeadlineTs === null) return -1;
        if (aDeadlineTs !== bDeadlineTs) return aDeadlineTs - bDeadlineTs;

        const aUpdatedTs = parseTimestamp(a.updated_at) || 0;
        const bUpdatedTs = parseTimestamp(b.updated_at) || 0;
        return bUpdatedTs - aUpdatedTs;
    });
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

    if (!canTransition((task as any).status as TaskStatus, "VOUCHER_ACCEPT")) {
        return { error: `Cannot accept task in ${(task as any).status} status` };
    }

    const cleanup = await deleteTaskProof(taskId, "voucher_accept");
    if (!cleanup.success) {
        return { error: cleanup.error || "Could not remove proof media." };
    }

    // @ts-ignore
    const { error } = await (supabase.from("tasks") as any)
        .update({ status: "COMPLETED" } as any)
        .eq("id", (taskId as any));

    if (error) {
        return { error: error.message };
    }

    // @ts-ignore
    await supabase.from("task_events").insert({
        task_id: taskId as any,
        event_type: "VOUCHER_ACCEPT",
        actor_id: (user as any).id,
        from_status: (task as any).status,
        to_status: "COMPLETED",
    });

    invalidatePendingVoucherRequestsCache((user as any).id);
    revalidatePath("/dashboard/voucher");
    revalidatePath(`/dashboard/tasks/${taskId}`);
    return { success: true };
}

export async function voucherDeleteTask(taskId: string) {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    // Fetch task with user info, ensure caller is voucher
    // @ts-ignore
    const { data: task } = await (supabase.from("tasks") as any)
        .select(`
      *,
      user:profiles!tasks_user_id_fkey(email, username)
    `)
        .eq("id", (taskId as any))
        .eq("voucher_id", (user as any).id)
        .single();

    if (!task) {
        return { error: "Task not found or you are not the voucher" };
    }

    // Check if task is in a non-final state
    const nonFinalStatuses = [
        "CREATED",
        "POSTPONED",
        "MARKED_COMPLETED",
        "AWAITING_VOUCHER",
    ];
    if (!nonFinalStatuses.includes((task as any).status)) {
        return { error: `Cannot delete task in ${(task as any).status} status` };
    }

    const cleanup = await deleteTaskProof(taskId, "voucher_delete");
    if (!cleanup.success) {
        return { error: cleanup.error || "Could not remove proof media." };
    }

    // Update status to DELETED (soft delete)
    const { error } = await (supabase.from("tasks") as any)
        .update({ status: "DELETED", updated_at: new Date().toISOString() } as any)
        .eq("id", (taskId as any))
        .eq("voucher_id", (user as any).id);

    if (error) {
        return { error: error.message };
    }

    // Log the deletion event
    await supabase.from("task_events").insert({
        task_id: taskId as any,
        event_type: "VOUCHER_DELETE",
        actor_id: (user as any).id,
        from_status: (task as any).status,
        to_status: "DELETED",
    } as any);

    // Notify the task owner via email (and push in tandem)
    if ((task as any).user?.email) {
        await sendNotification({
            to: (task as any).user.email,
            userId: (task as any).user.id, // Enable push bridge
            subject: `Task deleted by voucher: ${(task as any).title}`,
            title: "Task Deleted",
            html: `
          <h1>Task Deleted</h1>
          <p>Hi ${(task as any).user.username || "there"},</p>
          <p>Your voucher deleted the task: <strong>${(task as any).title}</strong>.</p>
          <p>If this was unexpected, please reach out to your voucher.</p>
          <br/>
          <a href="${process.env.NEXT_PUBLIC_APP_URL || ""}/dashboard">Go to Vouch</a>
        `,
        });
    }

    invalidatePendingVoucherRequestsCache((user as any).id);
    revalidatePath("/dashboard/voucher");
    revalidatePath("/dashboard");

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

    if (!canTransition((task as any).status as TaskStatus, "VOUCHER_DENY")) {
        return { error: `Cannot deny task in ${(task as any).status} status` };
    }

    const cleanup = await deleteTaskProof(taskId, "voucher_deny");
    if (!cleanup.success) {
        return { error: cleanup.error || "Could not remove proof media." };
    }

    // Add to ledger
    const currentPeriod = new Date().toISOString().slice(0, 7);

    // @ts-ignore
    const { error } = await (supabase.from("tasks") as any)
        .update({ status: "FAILED" } as any)
        .eq("id", (taskId as any));

    if (error) {
        return { error: error.message };
    }

    // Create ledger entry
    await (supabase.from("ledger_entries" as any) as any).insert({
        user_id: (task as any).user_id,
        task_id: taskId as any,
        period: currentPeriod,
        amount_cents: (task as any).failure_cost_cents,
        entry_type: "failure",
    });

    // @ts-ignore
    await (supabase.from("task_events") as any).insert({
        task_id: taskId as any,
        event_type: "VOUCHER_DENY",
        actor_id: (user as any).id,
        from_status: (task as any).status,
        to_status: "FAILED",
    });

    if ((task as any).user?.email) {
        await sendNotification({
            to: (task as any).user.email,
            userId: (task as any).user.id,
            subject: `Your task ${(task as any).title} has been denied`,
            title: "Task denied",
            text: `Your task ${(task as any).title} has been denied`,
            html: `
                <h1>Your task ${(task as any).title} has been denied</h1>
                <p>Hi ${(task as any).user.username || "there"},</p>
                <p>Your voucher denied <strong>${(task as any).title}</strong>.</p>
                <p>Failure cost was applied to your ledger.</p>
                <p><a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/tasks/${taskId}">Open task</a></p>
            `,
            url: `/dashboard/tasks/${taskId}`,
            tag: `task-denied-${taskId}`,
            data: { taskId, kind: "TASK_DENIED" },
        });
    }

    invalidatePendingVoucherRequestsCache((user as any).id);
    revalidatePath("/dashboard/voucher");
    revalidatePath(`/dashboard/tasks/${taskId}`);
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

    const failedAtTs = new Date((task as any).updated_at).getTime();
    if (Number.isNaN(failedAtTs)) {
        return { error: "Rectify window could not be evaluated." };
    }

    const rectifyExpiresAtTs = failedAtTs + RECTIFY_WINDOW_MS;
    if (Date.now() > rectifyExpiresAtTs) {
        return { error: "Rectify window expired (7 days)." };
    }

    // Check rectify pass usage
    const currentPeriod = new Date().toISOString().slice(0, 7);
    const { count } = await supabase
        .from("rectify_passes" as any)
        .select("*", { count: "exact", head: true })
        .eq("user_id", (task as any).user_id)
        .eq("period", currentPeriod);

    if ((count || 0) >= 5) {
        return { error: "User has already used all 5 rectify passes this month" };
    }

    // Update task
    const { error } = await (supabase.from("tasks") as any)
        .update({ status: "RECTIFIED" } as any)
        .eq("id", (taskId as any));

    if (error) {
        return { error: error.message };
    }

    // Create rectify pass record
    await (supabase.from("rectify_passes" as any) as any).insert({
        user_id: (task as any).user_id,
        task_id: (taskId as any),
        authorized_by: (user as any).id,
        period: currentPeriod,
    });

    // Create negative ledger entry to cancel out the failure
    await (supabase.from("ledger_entries" as any) as any).insert({
        user_id: (task as any).user_id,
        task_id: (taskId as any),
        period: currentPeriod,
        amount_cents: -(task as any).failure_cost_cents,
        entry_type: "rectified",
    });

    // @ts-ignore
    await (supabase.from("task_events") as any).insert({
        task_id: (taskId as any),
        event_type: "RECTIFY",
        actor_id: (user as any).id,
        from_status: "FAILED",
        to_status: "RECTIFIED",
    });

    revalidatePath("/dashboard/voucher");
    revalidatePath(`/dashboard/tasks/${taskId}`);
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
                    *,
                    user:profiles!tasks_user_id_fkey(*)
                `)
                .eq("voucher_id", voucherId as any)
                .in("status", PENDING_VOUCH_REQUEST_STATUSES as any)
                .order("updated_at", { ascending: false });

            const pendingTasks = (tasks as any[]) || [];
            if (pendingTasks.length === 0) return [];

            const taskIds = pendingTasks.map((task) => task.id);
            const ownerIds = [...new Set(pendingTasks.map((task) => task.user_id))];

            const [{ data: sessions }, { data: proofs }] = await Promise.all([
                // @ts-ignore
                (supabaseAdmin.from("pomo_sessions") as any)
                    .select("task_id, elapsed_seconds")
                    .in("task_id", taskIds as any)
                    .in("user_id", ownerIds as any)
                    .neq("status", "DELETED"),
                // @ts-ignore
                (supabaseAdmin.from("task_completion_proofs") as any)
                    .select("task_id, media_kind, mime_type, size_bytes, duration_ms, upload_state, updated_at")
                    .in("task_id", taskIds as any)
                    .eq("upload_state", "UPLOADED"),
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

export async function getCachedPendingVouchCountForVoucher(voucherId: string) {
    if (!voucherId) return 0;

    const loadPendingCount = unstable_cache(
        async () => {
            const supabaseAdmin = createAdminClient();

            const { count, error } = await (supabaseAdmin.from("tasks") as any)
                .select("*", { count: "exact", head: true })
                .eq("voucher_id", voucherId as any)
                .in("status", AWAITING_PENDING_STATUSES as any);

            if (error) {
                console.error("Failed to load pending vouch count:", error.message);
                return 0;
            }

            return count || 0;
        },
        ["pending-vouch-count", voucherId],
        {
            tags: [pendingVoucherRequestsTag(voucherId)],
            revalidate: 120,
        }
    );

    return loadPendingCount();
}

export async function getPendingVouchRequests(): Promise<VoucherPendingTask[]> {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return [];

    return getCachedPendingVouchRequestsForVoucher(user.id);
}

export async function getAssignedTasksForVoucher() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return [];

    // Include all non-final states; voucher can delete even active tasks
    const allowedStatuses = [
        "CREATED",
        "POSTPONED",
        "MARKED_COMPLETED",
        "AWAITING_VOUCHER",
    ];

    // @ts-ignore
    const { data: tasks } = await (supabase.from("tasks") as any)
        .select(`
      *,
      user:profiles!tasks_user_id_fkey(*)
    `)
        .eq("voucher_id", (user as any).id)
        .in("status", allowedStatuses)
        .order("deadline", { ascending: true });

    return (tasks as any) || [];
}

export async function getFailedTasks() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return [];

    const currentPeriod = new Date().toISOString().slice(0, 7);

    // Get failed tasks
    // @ts-ignore
    const { data: tasks } = await (supabase.from("tasks") as any)
        .select(`
      *,
      user:profiles!tasks_user_id_fkey(*)
    `)
        .eq("voucher_id", (user as any).id)
        .eq("status", "FAILED")
        .order("updated_at", { ascending: false });

    if (!tasks) return [];

    // Get pass counts for each owner
    const tasksWithCounts = await Promise.all(tasks.map(async (task: any) => {
        const { count } = await supabase
            .from("rectify_passes" as any)
            .select("*", { count: 'exact', head: true })
            .eq("user_id", task.user_id)
            .eq("period", currentPeriod);

        return { ...task, rectify_passes_used: count || 0 };
    }));

    return tasksWithCounts;
}

const FINAL_HISTORY_STATUSES = ["COMPLETED", "FAILED", "RECTIFIED", "SETTLED", "DELETED"];

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

export async function getVouchHistory() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return [];

    const currentPeriod = new Date().toISOString().slice(0, 7);

    // @ts-ignore
    const { data: tasks } = await (supabase.from("tasks") as any)
        .select(`
      *,
      user:profiles!tasks_user_id_fkey(*)
    `)
        .eq("voucher_id", (user as any).id)
        .in("status", FINAL_HISTORY_STATUSES)
        .order("updated_at", { ascending: false });

    if (!tasks) return [];

    const tasksWithCounts = await Promise.all(tasks.map(async (task: any) => {
        const { count } = await supabase
            .from("rectify_passes" as any)
            .select("*", { count: 'exact', head: true })
            .eq("user_id", task.user_id)
            .eq("period", currentPeriod);

        return { ...task, rectify_passes_used: count || 0 };
    }));

    return tasksWithCounts;
}
