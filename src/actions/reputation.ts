"use server";

import { createClient } from "@/lib/supabase/server";
import { computeFullReputationScore } from "@/lib/reputation/algorithm";
import type { ReputationTaskInput, ReputationScoreData } from "@/lib/reputation/types";

export async function getUserReputationScore(userId: string): Promise<ReputationScoreData | null> {
    if (!userId) return null;

    try {
        const supabase = await createClient();

        const [ownedResult, vouchedResult, pomoResult] = await Promise.all([
            supabase
                .from("tasks")
                .select(
                    "id, user_id, voucher_id, status, deadline, created_at, updated_at, marked_completed_at, postponed_at, recurrence_rule_id, voucher_timeout_auto_accepted, has_proof"
                )
                .eq("user_id", userId)
                .neq("status", "DELETED"),
            supabase
                .from("tasks")
                .select(
                    "id, user_id, voucher_id, status, deadline, created_at, updated_at, marked_completed_at, postponed_at, recurrence_rule_id, voucher_timeout_auto_accepted, has_proof"
                )
                .eq("voucher_id", userId)
                .neq("user_id", userId)
                .neq("status", "DELETED"),
            supabase
                .from("pomo_sessions")
                .select("task_id, elapsed_seconds")
                .eq("user_id", userId)
                .neq("status", "DELETED"),
        ]);

        if (ownedResult.error || vouchedResult.error) return null;

        const pomoByTask = new Map<string, number>();
        for (const row of (pomoResult.data ?? []) as { task_id: string; elapsed_seconds: number }[]) {
            pomoByTask.set(row.task_id, (pomoByTask.get(row.task_id) ?? 0) + (row.elapsed_seconds ?? 0));
        }

        const mapTask = (t: Record<string, unknown>): ReputationTaskInput => ({
            id: t.id as string,
            user_id: t.user_id as string,
            voucher_id: (t.voucher_id as string | null) ?? null,
            status: t.status as string,
            deadline: (t.deadline as string | null) ?? null,
            created_at: t.created_at as string,
            updated_at: t.updated_at as string,
            marked_completed_at: (t.marked_completed_at as string | null) ?? null,
            postponed_at: (t.postponed_at as string | null) ?? null,
            recurrence_rule_id: (t.recurrence_rule_id as string | null) ?? null,
            voucher_timeout_auto_accepted: (t.voucher_timeout_auto_accepted as boolean | null) ?? null,
            has_uploaded_proof: (t.has_proof as boolean | null) ?? false,
            pomo_total_seconds: pomoByTask.get(t.id as string) ?? 0,
        });

        const owned = (ownedResult.data ?? []).map(mapTask);
        const vouched = (vouchedResult.data ?? []).map(mapTask);

        return computeFullReputationScore([...owned, ...vouched], userId);
    } catch {
        return null;
    }
}
