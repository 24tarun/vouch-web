"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidateTaskAndSocialSurfaces } from "./helpers";

export interface PausedRecurrenceSettingsPatch {
    timeOfDay?: string;
    failureCostCents?: number;
    voucherId?: string;
    requiresProof?: boolean;
}

export interface PausedRecurrenceSettings {
    recurrenceRuleId: string;
    timeOfDay: string;
    failureCostCents: number;
    voucherId: string;
    requiresProof: boolean;
    updatedAt: string;
}

export async function updatePausedRecurrenceSettings(
    taskId: string,
    patch: PausedRecurrenceSettingsPatch
): Promise<{ success?: true; settings?: PausedRecurrenceSettings; error?: string }> {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { error: "Not authenticated" };
    if (!taskId) return { error: "Task is required" };

    const updateRecurrenceSettingsRpc = supabase.rpc as unknown as (
        functionName: "update_paused_recurrence_settings",
        args: {
            p_task_id: string;
            p_time_of_day: string | null;
            p_failure_cost_cents: number | null;
            p_voucher_id: string | null;
            p_requires_proof: boolean | null;
        }
    ) => Promise<{
        data: unknown;
        error: { message: string } | null;
    }>;
    const { data, error } = await updateRecurrenceSettingsRpc("update_paused_recurrence_settings", {
        p_task_id: taskId,
        p_time_of_day: patch.timeOfDay ?? null,
        p_failure_cost_cents: patch.failureCostCents ?? null,
        p_voucher_id: patch.voucherId ?? null,
        p_requires_proof: patch.requiresProof ?? null,
    });

    if (error) return { error: error.message };

    const row = (Array.isArray(data) ? data[0] : data) as {
        recurrence_rule_id?: string;
        time_of_day?: string;
        failure_cost_cents?: number;
        voucher_id?: string;
        requires_proof?: boolean;
        updated_at?: string;
    } | null;

    if (
        !row?.recurrence_rule_id ||
        !row.time_of_day ||
        !row.voucher_id ||
        typeof row.failure_cost_cents !== "number"
    ) {
        return { error: "Future repetition settings could not be updated" };
    }

    revalidateTaskAndSocialSurfaces(taskId, user.id, row.voucher_id);
    return {
        success: true,
        settings: {
            recurrenceRuleId: row.recurrence_rule_id,
            timeOfDay: row.time_of_day,
            failureCostCents: row.failure_cost_cents,
            voucherId: row.voucher_id,
            requiresProof: Boolean(row.requires_proof),
            updatedAt: row.updated_at || new Date().toISOString(),
        },
    };
}
