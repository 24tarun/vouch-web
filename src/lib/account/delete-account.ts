/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { TASK_PROOFS_BUCKET } from "@/lib/task-proof-shared";

export async function deleteAccountByUserId(
    userId: string,
    currentUserClient?: SupabaseClient<Database>
): Promise<{ success: true } | { error: string }> {
    const supabaseAdmin = createAdminClient();

    const OPEN_VOUCHER_BLOCKING_STATUSES = [
        "ACTIVE",
        "POSTPONED",
        "MARKED_COMPLETED",
        "MARKED_COMPLETE",
        "AWAITING_VOUCHER",
        "AWAITING_AI",
        "AWAITING_USER",
        "ESCALATED",
    ];
    const FINAL_TASK_STATUSES = [
        "COMPLETED",
        "FAILED",
        "ACCEPTED",
        "AUTO_ACCEPTED",
        "AI_ACCEPTED",
        "DENIED",
        "MISSED",
        "SURRENDERED",
        "RECTIFIED",
        "SETTLED",
        "DELETED",
    ];

    // Block deletion if this user is still voucher for other users' open/in-flight work.
    const [blockingTaskCountResult, blockingRuleCountResult, blockingRectificationCountResult] = await Promise.all([
        (supabaseAdmin.from("tasks") as any)
            .select("id", { count: "exact", head: true })
            .eq("voucher_id", userId as any)
            .neq("user_id", userId as any)
            .in("status", OPEN_VOUCHER_BLOCKING_STATUSES as any),
        (supabaseAdmin.from("recurrence_rules") as any)
            .select("id", { count: "exact", head: true })
            .eq("voucher_id", userId as any)
            .neq("user_id", userId as any),
        (supabaseAdmin.from("rectification_requests") as any)
            .select("id", { count: "exact", head: true })
            .eq("target_voucher_id", userId as any)
            .neq("owner_id", userId as any)
            .eq("target_type", "ORIGINAL_VOUCHER")
            .eq("state", "PENDING_HUMAN"),
    ]);

    if (blockingTaskCountResult.error) {
        return { error: blockingTaskCountResult.error.message };
    }
    if (blockingRuleCountResult.error) {
        return { error: blockingRuleCountResult.error.message };
    }
    if (blockingRectificationCountResult.error) {
        return { error: blockingRectificationCountResult.error.message };
    }

    const blockingTaskCount = blockingTaskCountResult.count || 0;
    const blockingRuleCount = blockingRuleCountResult.count || 0;
    const blockingRectificationCount = blockingRectificationCountResult.count || 0;
    if (blockingTaskCount > 0 || blockingRuleCount > 0 || blockingRectificationCount > 0) {
        return {
            error:
                `Account deletion is blocked because you're still assigned as voucher for ` +
                `${blockingTaskCount} open task${blockingTaskCount === 1 ? "" : "s"} and ` +
                `${blockingRuleCount} recurring rule${blockingRuleCount === 1 ? "" : "s"}, and ` +
                `${blockingRectificationCount} rectification request${blockingRectificationCount === 1 ? "" : "s"} owned by other users. ` +
                `Please ask them to change voucher first.`,
        };
    }

    // Preserve other users' history: reassign voucher to owner for finalized tasks
    // that currently reference the deleting user as voucher.
    const { data: historicalTasksToReassign, error: historicalTasksToReassignError } = await (supabaseAdmin.from("tasks") as any)
        .select("id, user_id")
        .eq("voucher_id", userId as any)
        .neq("user_id", userId as any)
        .in("status", FINAL_TASK_STATUSES as any);

    if (historicalTasksToReassignError) {
        return { error: historicalTasksToReassignError.message };
    }

    for (const task of ((historicalTasksToReassign as Array<{ id: string; user_id: string }> | null) || [])) {
        const { error: reassignVoucherError } = await (supabaseAdmin.from("tasks") as any)
            .update({ voucher_id: task.user_id } as any)
            .eq("id", task.id as any);

        if (reassignVoucherError) {
            return { error: reassignVoucherError.message };
        }
    }

    const [ownerProofRowsResult, voucherProofRowsResult] = await Promise.all([
        (supabaseAdmin.from("task_completion_proofs") as any)
            .select("bucket, object_path")
            .eq("owner_id", userId as any),
        (supabaseAdmin.from("task_completion_proofs") as any)
            .select("bucket, object_path")
            .eq("voucher_id", userId as any),
    ]);

    if (ownerProofRowsResult.error) {
        return { error: ownerProofRowsResult.error.message };
    }

    if (voucherProofRowsResult.error) {
        return { error: voucherProofRowsResult.error.message };
    }

    const { error: recurrenceRulesDeleteError } = await (supabaseAdmin.from("recurrence_rules") as any)
        .delete()
        .eq("voucher_id", userId as any);

    if (recurrenceRulesDeleteError) {
        return { error: recurrenceRulesDeleteError.message };
    }

    const { error: taskEventsUpdateError } = await (supabaseAdmin.from("task_events") as any)
        .update({ actor_id: null } as any)
        .eq("actor_id", userId as any);

    if (taskEventsUpdateError) {
        return { error: taskEventsUpdateError.message };
    }

    const { error: rectifyPassesUpdateError } = await (supabaseAdmin.from("rectify_passes") as any)
        .update({ authorized_by: null } as any)
        .eq("authorized_by", userId as any);

    if (rectifyPassesUpdateError) {
        return { error: rectifyPassesUpdateError.message };
    }

    const { data: historicalRectifications, error: historicalRectificationsError } = await (supabaseAdmin.from("rectification_requests") as any)
        .select("id, owner_id, original_voucher_id, target_voucher_id")
        .neq("owner_id", userId as any)
        .or(`original_voucher_id.eq.${userId},target_voucher_id.eq.${userId}`);
    if (historicalRectificationsError) return { error: historicalRectificationsError.message };
    for (const request of ((historicalRectifications as Array<{
        id: string; owner_id: string; original_voucher_id: string; target_voucher_id: string;
    }> | null) || [])) {
        const { error: reassignRequestError } = await (supabaseAdmin.from("rectification_requests") as any)
            .update({
                original_voucher_id: request.original_voucher_id === userId ? request.owner_id : request.original_voucher_id,
                target_voucher_id: request.target_voucher_id === userId ? request.owner_id : request.target_voucher_id,
            } as any)
            .eq("id", request.id as any);
        if (reassignRequestError) return { error: reassignRequestError.message };
    }

    const proofRows = [
        ...(((ownerProofRowsResult.data as Array<{ bucket: string | null; object_path: string | null }> | null) || [])),
        ...(((voucherProofRowsResult.data as Array<{ bucket: string | null; object_path: string | null }> | null) || [])),
    ];

    const bucketToPaths = new Map<string, Set<string>>();
    for (const row of proofRows) {
        const objectPath = row.object_path?.trim();
        if (!objectPath) continue;

        const bucket = (row.bucket?.trim() || TASK_PROOFS_BUCKET);
        const existing = bucketToPaths.get(bucket) || new Set<string>();
        existing.add(objectPath);
        bucketToPaths.set(bucket, existing);
    }

    const STORAGE_REMOVE_CHUNK_SIZE = 100;
    for (const [bucket, pathSet] of bucketToPaths.entries()) {
        const paths = Array.from(pathSet.values());
        for (let i = 0; i < paths.length; i += STORAGE_REMOVE_CHUNK_SIZE) {
            const chunk = paths.slice(i, i + STORAGE_REMOVE_CHUNK_SIZE);
            const { error: storageRemoveError } = await supabaseAdmin.storage.from(bucket).remove(chunk);
            if (storageRemoveError) {
                console.error(`Failed deleting proof media from storage bucket ${bucket}:`, storageRemoveError);
            }
        }
    }

    if (currentUserClient) {
        const { error: signOutError } = await currentUserClient.auth.signOut();
        if (signOutError) {
            return { error: signOutError.message };
        }
    }

    const { error: deleteUserError } = await supabaseAdmin.auth.admin.deleteUser(userId, false);
    if (deleteUserError) {
        return { error: deleteUserError.message };
    }

    return { success: true };
}
