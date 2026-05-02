"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canTransition, type TaskStatus } from "@/lib/xstate/task-machine";
import { isOwnerTempDeletableStatus, getOwnerDeleteRemainingMs } from "@/lib/task-delete-window";
import { resolveWebUserClientInstanceId } from "@/lib/user-client-instance";
import {
    canPostponeDailyRecurringTaskToDeadline,
    shouldRestrictDailyPostponeToSameRuleDay,
} from "@/lib/postpone-daily-recurrence";
import {
    invalidateActiveTasksCache,
    invalidatePendingVoucherRequestsCache,
    enqueueGoogleCalendarUpsert,
    enqueueGoogleCalendarDelete,
    revalidateTaskSurfaces,
    realignTaskRemindersAfterPostpone,
    parseAndValidateFutureDeadline,
    INVALID_DEADLINE_ERROR,
    DAILY_RECURRING_POSTPONE_SAME_DAY_ERROR,
} from "./helpers";

export async function postponeTask(taskId: string, newDeadlineIso: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const { data: task } = await (supabase.from("tasks") as any)
        .select("*")
        .eq("id", (taskId as any))
        .eq("user_id", (user as any).id)
        .single();

    if (!task) {
        return { error: "Task not found" };
    }

    if (typeof newDeadlineIso !== "string" || !newDeadlineIso.trim()) {
        return { error: INVALID_DEADLINE_ERROR };
    }

    const deadlineValidation = parseAndValidateFutureDeadline(newDeadlineIso);
    if (!deadlineValidation.deadline) {
        return { error: deadlineValidation.error || INVALID_DEADLINE_ERROR };
    }
    const newDeadlineDate = deadlineValidation.deadline;

    const currentDeadline = new Date((task as any).deadline);
    if (Number.isNaN(currentDeadline.getTime())) {
        return { error: INVALID_DEADLINE_ERROR };
    }

    if (Date.now() >= currentDeadline.getTime()) {
        return { error: "Deadline has passed" };
    }
    if (!canTransition((task as any).status as TaskStatus, "POSTPONE")) {
        return { error: `Cannot postpone task in ${(task as any).status} status` };
    }
    if ((task as any).postponed_at) {
        return { error: "Task has already been postponed once" };
    }

    if ((task as any).recurrence_rule_id) {
        const { data: recurrenceRule, error: recurrenceRuleError } = await (supabase.from("recurrence_rules") as any)
            .select("rule_config, timezone")
            .eq("id", (task as any).recurrence_rule_id)
            .eq("user_id", user.id)
            .maybeSingle();

        if (recurrenceRuleError) {
            return { error: recurrenceRuleError.message };
        }

        if (shouldRestrictDailyPostponeToSameRuleDay((recurrenceRule as any)?.rule_config)) {
            const recurrenceTimeZone =
                typeof (recurrenceRule as any)?.timezone === "string"
                    ? ((recurrenceRule as any).timezone as string)
                    : null;
            const canPostponeWithinSameRuleDay = canPostponeDailyRecurringTaskToDeadline(
                currentDeadline,
                newDeadlineDate,
                recurrenceTimeZone
            );

            if (!canPostponeWithinSameRuleDay) {
                return { error: DAILY_RECURRING_POSTPONE_SAME_DAY_ERROR };
            }
        }
    }

    if (["AWAITING_VOUCHER", "AWAITING_AI", "MARKED_COMPLETE", "ACCEPTED", "AUTO_ACCEPTED", "AI_ACCEPTED", "DENIED", "MISSED", "RECTIFIED", "SETTLED", "DELETED"].includes((task as any).status)) {
        return { error: `Cannot postpone task in ${(task as any).status} status` };
    }

    const expectedStatus = (task as any).status as TaskStatus;
    const currentDeadlineIso = currentDeadline.toISOString();
    // @ts-ignore
    const { data: updatedRows, error } = await (supabase.from("tasks") as any)
        .update({
            status: "POSTPONED",
            deadline: newDeadlineDate.toISOString(),
            postponed_at: new Date().toISOString(),
        } as any)
        .eq("id", (taskId as any))
        .eq("user_id", user.id)
        .eq("status", expectedStatus as any)
        .eq("deadline", currentDeadlineIso as any)
        .is("postponed_at", null)
        .gt("deadline", new Date().toISOString() as any)
        .select("id");

    if (error) {
        return { error: error.message };
    }
    if (!updatedRows || updatedRows.length === 0) {
        return { error: "Task can no longer be postponed. Please refresh." };
    }

    const reminderRealignment = await realignTaskRemindersAfterPostpone(
        supabase,
        taskId,
        user.id,
        currentDeadline,
        newDeadlineDate
    );
    if (reminderRealignment.error) {
        return { error: reminderRealignment.error };
    }

    await (supabase.from("task_events") as any).insert({
        task_id: taskId as any,
        event_type: "POSTPONE",
        actor_id: (user as any).id,
        actor_user_client_instance_id: await resolveWebUserClientInstanceId(user.id),
        from_status: (task as any).status,
        to_status: "POSTPONED",
        metadata: { new_deadline: newDeadlineDate.toISOString() },
    });

    await enqueueGoogleCalendarUpsert(user.id, taskId);

    invalidatePendingVoucherRequestsCache((task as any).voucher_id);
    revalidatePath("/friends");
    revalidateTaskSurfaces(taskId, user.id);
    return { success: true };
}

export async function ownerTempDeleteTask(taskId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const { data: task } = await (supabase.from("tasks") as any)
        .select("id, user_id, voucher_id, status, created_at")
        .eq("id", taskId as any)
        .eq("user_id", user.id as any)
        .single();

    if (!task) {
        return { error: "Task not found" };
    }

    const { data: linkedLinks } = await (supabase.from("commitment_task_links") as any)
        .select("id, commitment_id, commitments!inner(name, status)")
        .eq("task_id", taskId as any);

    if (((linkedLinks as any[]) || []).length > 0) {
        for (const link of ((linkedLinks as any[]) || [])) {
            if (link?.commitments?.status === "ACTIVE") {
                return {
                    error: `This task is part of the active commitment '${link.commitments.name}'. Delete that commitment first.`,
                };
            }
        }

        const draftLinkIds = ((linkedLinks as any[]) || [])
            .filter((link) => link?.commitments?.status === "DRAFT" && link?.id)
            .map((link) => link.id);

        if (draftLinkIds.length > 0) {
            await (supabase.from("commitment_task_links") as any)
                .delete()
                .in("id", draftLinkIds as any);
        }
    }

    if (!isOwnerTempDeletableStatus(task.status as TaskStatus)) {
        return { error: `Cannot delete task in ${(task as any).status} status` };
    }

    if (getOwnerDeleteRemainingMs((task as any).created_at) <= 0) {
        return { error: "Delete window expired. Tasks can only be deleted within 10 minutes." };
    }

    const supabaseAdmin = createAdminClient();
    let googleDeletePayload: {
        google_event_id?: string;
        calendar_id?: string;
    } | undefined;

    const { data: googleLink, error: googleLinkError } = await (supabaseAdmin.from("google_calendar_task_links") as any)
        .select("google_event_id, calendar_id")
        .eq("task_id", taskId as any)
        .eq("user_id", user.id as any)
        .maybeSingle();

    if (googleLinkError) {
        console.error("Failed to read Google Calendar link before ownerTempDeleteTask:", googleLinkError);
    } else if ((googleLink as any)?.google_event_id || (googleLink as any)?.calendar_id) {
        googleDeletePayload = {
            google_event_id: (googleLink as any).google_event_id ?? undefined,
            calendar_id: (googleLink as any).calendar_id ?? undefined,
        };
    }

    const { data: deletedRows, error } = await (supabaseAdmin.from("tasks") as any)
        .delete()
        .eq("id", taskId as any)
        .eq("user_id", user.id as any)
        .in("status", ["ACTIVE", "POSTPONED"] as any)
        .select("id");

    if (error) {
        return { error: error.message };
    }

    if (!deletedRows || deletedRows.length === 0) {
        return { error: "Task can no longer be deleted. Please refresh." };
    }

    await enqueueGoogleCalendarDelete(user.id, taskId, googleDeletePayload);

    invalidateActiveTasksCache(user.id);
    invalidatePendingVoucherRequestsCache((task as any).voucher_id);
    revalidatePath("/tasks");
    revalidatePath("/friends");
    revalidatePath("/stats");
    revalidatePath(`/tasks/${taskId}`);
    return { success: true };
}
