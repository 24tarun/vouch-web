"use server";

import { revalidatePath } from "next/cache";
import { type SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type Database } from "@/lib/types";
import { resolveWebUserClientInstanceId } from "@/lib/user-client-instance";
import { parseProofRequiredFromTitle } from "@/lib/task-title-parser";
import {
    resolveEventColorFromTitle,
    validateEventColorUsage,
} from "@/lib/task-title-event-color";
import { resolveEventSchedule } from "@/lib/task-title-event-time";
import { DEFAULT_FAILURE_COST_CENTS, DEFAULT_EVENT_DURATION_MINUTES } from "@/lib/constants";
import { buildDefaultDeadlineReminderRows } from "@/lib/task-reminder-defaults";
import { getCurrencySymbol, getFailureCostBounds, normalizeCurrency } from "@/lib/currency";
import {
    createTaskSchema,
    normalizeTaskTitleAndSyncKind,
    normalizeSubtaskTitles,
    normalizeSubtasksFromFormData,
    parseRequiresProofFromFormData,
    getDefaultTaskDeadline,
    normalizeRemindersFromFormData,
    buildManualReminderOffsetsFromDeadline,
    parseRequiredPomoMinutesFromFormData,
    insertTaskReminders,
    insertTaskReminderRows,
    insertTaskSubtasks,
    invalidateActiveTasksCache,
    invalidatePendingVoucherRequestsCache,
    enqueueGoogleCalendarUpsert,
    revalidateTaskSurfaces,
    RecurrenceRuleTable,
    TITLE_REQUIRED_ERROR,
    PAST_DEADLINE_ERROR,
    INVALID_DEADLINE_ERROR,
    EVENT_BOUNDARY_REQUIRED_ERROR,
    INVALID_EVENT_START_ERROR,
    INVALID_EVENT_END_ERROR,
    EVENT_END_NOT_AFTER_START_ERROR,
} from "./helpers";

export async function createTaskSimple(title: string, subtasksInput?: string[]) {
    const parsedTaskSimple = createTaskSchema.safeParse({ title });
    if (!parsedTaskSimple.success) {
        return { error: parsedTaskSimple.error.issues[0].message };
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return { error: "Not authenticated" };
    const actorUserClientInstanceId = await resolveWebUserClientInstanceId(user.id);

    const requiresProof = parseProofRequiredFromTitle(title);
    const normalizedTitle = normalizeTaskTitleAndSyncKind(title);
    const colorValidation = validateEventColorUsage(title, normalizedTitle.googleSyncForTask);
    if (colorValidation.error) {
        return { error: colorValidation.error };
    }
    const colorSelection = resolveEventColorFromTitle(title);
    const googleEventColorId = normalizedTitle.googleSyncForTask ? colorSelection.colorId : null;
    if (!normalizedTitle.normalizedTitle) {
        return { error: TITLE_REQUIRED_ERROR };
    }

    const normalizedSubtasks = normalizeSubtaskTitles(subtasksInput ?? []);
    if (normalizedSubtasks.error) {
        return { error: normalizedSubtasks.error };
    }

    // @ts-ignore
    const { data: profileDefaults } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

    // @ts-ignore
    const { data: friends } = await supabase
        .from("friendships")
        .select("friend_id")
        .eq("user_id", user.id);

    const friendIds = new Set(((friends as any[]) || []).map((f) => f.friend_id));
    const preferredVoucherId = (profileDefaults as any)?.default_voucher_id as string | null | undefined;
    const defaultVoucherId =
        preferredVoucherId === user.id
            ? user.id
            : preferredVoucherId && friendIds.has(preferredVoucherId)
                ? preferredVoucherId
                : user.id;

    const defaultFailureCostCents =
        ((profileDefaults as any)?.default_failure_cost_cents as number | undefined) ??
        DEFAULT_FAILURE_COST_CENTS;
    const defaultEventDurationMinutesRaw = Number((profileDefaults as any)?.default_event_duration_minutes);
    const defaultEventDurationMinutes =
        Number.isInteger(defaultEventDurationMinutesRaw) &&
            defaultEventDurationMinutesRaw >= 1 &&
            defaultEventDurationMinutesRaw <= 720
            ? defaultEventDurationMinutesRaw
            : DEFAULT_EVENT_DURATION_MINUTES;
    const { AI_PROFILE_ID: AI_ID_SIMPLE } = await import("@/lib/ai-voucher/constants");

    let deadline = getDefaultTaskDeadline();
    let eventStartAtIso: string | null = null;
    let eventEndAtIso: string | null = null;
    let shouldAutoCompletePastEvent = false;
    const creationNow = new Date();
    const creationNowIso = creationNow.toISOString();

    if (normalizedTitle.googleSyncForTask) {
        const eventResolution = resolveEventSchedule({
            rawTitle: title,
            anchorDate: deadline,
            defaultDurationMinutes: defaultEventDurationMinutes,
        });

        if (eventResolution.error || !eventResolution.startDate || !eventResolution.endDate) {
            return { error: eventResolution.error || "Event time is invalid." };
        }

        deadline = eventResolution.endDate;
        eventStartAtIso = eventResolution.startDate.toISOString();
        eventEndAtIso = eventResolution.endDate.toISOString();
        shouldAutoCompletePastEvent =
            eventResolution.startDate.getTime() <= creationNow.getTime() &&
            eventResolution.endDate.getTime() <= creationNow.getTime();
    }

    const finalRequiresProofSimple = defaultVoucherId === AI_ID_SIMPLE ? true : requiresProof;

    // @ts-ignore
    const { data: task, error } = await (supabase.from("tasks") as any)
        .insert({
            user_id: user.id,
            voucher_id: defaultVoucherId,
            title: normalizedTitle.normalizedTitle,
            creation_input: title,
            description: null,
            failure_cost_cents: defaultFailureCostCents,
            requires_proof: finalRequiresProofSimple,
            deadline: deadline.toISOString(),
            status: shouldAutoCompletePastEvent ? "ACCEPTED" : "ACTIVE",
            marked_completed_at: shouldAutoCompletePastEvent ? creationNowIso : null,
            voucher_response_deadline: null,
            google_sync_for_task: normalizedTitle.googleSyncForTask,
            google_event_start_at: eventStartAtIso,
            google_event_end_at: eventEndAtIso,
            google_event_color_id: googleEventColorId,
            created_by_user_client_instance_id: actorUserClientInstanceId,
        })
        .select()
        .single();

    if (error) throw new Error(error.message);

    const seededDefaultReminders = buildDefaultDeadlineReminderRows({
        parentTaskId: (task as any).id,
        userId: user.id,
        deadline,
        deadlineOneHourWarningEnabled: true,
        deadlineFinalWarningEnabled: true,
        now: new Date(),
    });
    await insertTaskReminderRows(supabase as SupabaseClient<Database>, seededDefaultReminders, { ignoreDuplicates: true });

    if (!shouldAutoCompletePastEvent && normalizedSubtasks.titles.length > 0) {
        await insertTaskSubtasks(supabase as SupabaseClient<Database>, user.id, (task as any).id, normalizedSubtasks.titles);
    }

    await enqueueGoogleCalendarUpsert(user.id, (task as any).id);
    invalidatePendingVoucherRequestsCache(defaultVoucherId);
    revalidateTaskSurfaces((task as any).id, user.id);
    return { success: true, taskId: (task as any).id };
}

export async function getCachedActiveTasksForUser(userId: string) {
    if (!userId) return [];

    const supabaseAdmin = createAdminClient();
    // @ts-ignore
    const { data, error } = await (supabaseAdmin.from("tasks") as any)
        .select("*")
        .eq("user_id", userId as any)
        .in("status", ["ACTIVE", "POSTPONED"])
        .order("deadline", { ascending: true });

    if (error) {
        console.error("Failed to load active tasks:", error.message);
        return [];
    }

    return (data as any[]) || [];
}

export async function createTask(formData: FormData) {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }
    const actorUserClientInstanceId = await resolveWebUserClientInstanceId(user.id);

    const submittedTitle = formData.get("title") as string;
    const rawTitleForm = formData.get("rawTitle");
    const rawTitle =
        typeof rawTitleForm === "string" && rawTitleForm.trim()
            ? rawTitleForm
            : (submittedTitle || "");
    const parserSourceTitle = rawTitle || submittedTitle || "";
    const titleSelection = normalizeTaskTitleAndSyncKind(rawTitle || "");
    const title = normalizeTaskTitleAndSyncKind(submittedTitle || rawTitle).normalizedTitle;
    const requiresProofInput = parseRequiresProofFromFormData(
        formData.get("requiresProof"),
        parseProofRequiredFromTitle(parserSourceTitle)
    );
    const colorValidation = validateEventColorUsage(rawTitle || "", titleSelection.googleSyncForTask);
    if (colorValidation.error) {
        return { error: colorValidation.error };
    }
    const colorSelection = resolveEventColorFromTitle(rawTitle || "");
    const googleEventColorId = titleSelection.googleSyncForTask ? colorSelection.colorId : null;
    const description = formData.get("description") as string;
    const failureCostMajor = Number(formData.get("failureCost"));
    const deadline = formData.get("deadline") as string;
    const submittedEventStartIsoRaw = formData.get("eventStartIso");
    const submittedEventStartIso =
        typeof submittedEventStartIsoRaw === "string"
            ? submittedEventStartIsoRaw.trim()
            : "";
    const submittedEventEndIsoRaw = formData.get("eventEndIso");
    const submittedEventEndIso =
        typeof submittedEventEndIsoRaw === "string"
            ? submittedEventEndIsoRaw.trim()
            : "";
    const voucherId = formData.get("voucherId") as string;
    const subtasksInput = normalizeSubtasksFromFormData(formData.get("subtasks"));
    const requiredPomoInput = parseRequiredPomoMinutesFromFormData(formData.get("requiredPomoMinutes"));

    const parsedCreateTask = createTaskSchema.safeParse({ title: title || "" });
    if (!parsedCreateTask.success) {
        return { error: parsedCreateTask.error.issues[0].message };
    }

    if (!title) {
        return { error: TITLE_REQUIRED_ERROR };
    }

    if (!deadline || !voucherId || !Number.isFinite(failureCostMajor)) {
        return { error: "Missing required fields" };
    }
    if (subtasksInput.error) {
        return { error: subtasksInput.error };
    }
    if (requiredPomoInput.error) {
        return { error: requiredPomoInput.error };
    }
    if (requiresProofInput.error) {
        return { error: requiresProofInput.error };
    }

    const { data: reminderDefaultsProfile } = await supabase
        .from("profiles")
        .select("deadline_one_hour_warning_enabled, deadline_final_warning_enabled, currency, default_event_duration_minutes")
        .eq("id", user.id as any)
        .maybeSingle();

    const ownerCurrency = normalizeCurrency((reminderDefaultsProfile as { currency?: unknown } | null)?.currency);
    const failureCostBounds = getFailureCostBounds(ownerCurrency);
    const failureCostCents = Math.round(failureCostMajor * 100);

    const parsedDeadline = new Date(deadline);
    if (Number.isNaN(parsedDeadline.getTime())) {
        return { error: INVALID_DEADLINE_ERROR };
    }
    if (!titleSelection.googleSyncForTask && parsedDeadline.getTime() <= Date.now()) {
        return { error: PAST_DEADLINE_ERROR };
    }
    if (titleSelection.isStrict && !titleSelection.googleSyncForTask) {
        return { error: "-strict requires an event. Add -event to the title." };
    }
    const validatedDeadline = parsedDeadline;
    let eventStartAtIso: string | null = null;
    let eventEndAtIso: string | null = null;
    let shouldAutoCompletePastEvent = false;
    const creationNow = new Date();
    const creationNowIso = creationNow.toISOString();
    const defaultEventDurationMinutesRaw = Number(
        (reminderDefaultsProfile as { default_event_duration_minutes?: unknown } | null)?.default_event_duration_minutes
    );
    const defaultEventDurationMinutes =
        Number.isInteger(defaultEventDurationMinutesRaw) &&
            defaultEventDurationMinutesRaw >= 1 &&
            defaultEventDurationMinutesRaw <= 720
            ? defaultEventDurationMinutesRaw
            : DEFAULT_EVENT_DURATION_MINUTES;

    if (titleSelection.googleSyncForTask) {
        if (!submittedEventStartIso || !submittedEventEndIso) {
            return { error: EVENT_BOUNDARY_REQUIRED_ERROR };
        }

        const parsedEventStart = new Date(submittedEventStartIso);
        if (Number.isNaN(parsedEventStart.getTime())) {
            return { error: INVALID_EVENT_START_ERROR };
        }

        const parsedEventEnd = new Date(submittedEventEndIso);
        if (Number.isNaN(parsedEventEnd.getTime())) {
            return { error: INVALID_EVENT_END_ERROR };
        }
        if (parsedEventEnd.getTime() <= parsedEventStart.getTime()) {
            return { error: EVENT_END_NOT_AFTER_START_ERROR };
        }

        validatedDeadline.setTime(parsedEventEnd.getTime());
        eventStartAtIso = parsedEventStart.toISOString();
        eventEndAtIso = parsedEventEnd.toISOString();
        shouldAutoCompletePastEvent =
            parsedEventStart.getTime() <= creationNow.getTime() &&
            parsedEventEnd.getTime() <= creationNow.getTime();
    }
    const remindersInput = normalizeRemindersFromFormData(formData.get("reminders"), validatedDeadline);
    if (remindersInput.error) {
        return { error: remindersInput.error };
    }
    const manualReminderOffsetsMs = buildManualReminderOffsetsFromDeadline(
        validatedDeadline,
        remindersInput.reminderDates
    );
    const eventDurationMinutes = eventStartAtIso
        ? Math.max(1, Math.round((validatedDeadline.getTime() - new Date(eventStartAtIso).getTime()) / (1000 * 60)))
        : null;

    if (failureCostCents < failureCostBounds.minCents || failureCostCents > failureCostBounds.maxCents) {
        const currencySymbol = getCurrencySymbol(ownerCurrency);
        return {
            error: `Failure cost must be between ${currencySymbol}${failureCostBounds.minMajor} and ${currencySymbol}${failureCostBounds.maxMajor}.`,
        };
    }

    const { AI_PROFILE_ID } = await import("@/lib/ai-voucher/constants");
    const isAiVoucher = voucherId === AI_PROFILE_ID;

    if (voucherId !== (user as any).id) {
        // @ts-ignore
        const { data: friendship } = await supabase
            .from("friendships")
            .select("*")
            .eq("user_id", (user as any).id)
            .eq("friend_id", voucherId as any)
            .single();

        if (!friendship) {
            return { error: "You can only assign yourself or friends as vouchers" };
        }
    }

    const finalRequiresProof = isAiVoucher ? true : requiresProofInput.requiresProof;

    const recurrenceType = formData.get("recurrenceType") as string;
    const recurrenceInterval = parseInt(formData.get("recurrenceInterval") as string || "1");
    const recurrenceDaysStr = formData.get("recurrenceDays") as string;
    const recurrenceDays = recurrenceDaysStr ? JSON.parse(recurrenceDaysStr) : undefined;
    const userTimezone = formData.get("userTimezone") as string;

    let recurrenceRuleId: string | null = null;

    if (recurrenceType && userTimezone) {
        const initialDeadlineDate = validatedDeadline;
        const timeFormatter = new Intl.DateTimeFormat("en-GB", {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: userTimezone
        });
        const timeOfDay = timeFormatter.format(initialDeadlineDate);

        const ruleConfig = {
            frequency: recurrenceType,
            interval: recurrenceInterval,
            days_of_week: recurrenceDays,
            time_of_day: timeOfDay
        };

        // @ts-ignore
        const { data: rule, error: ruleError } = await (supabase.from(RecurrenceRuleTable) as any)
            .insert({
                user_id: (user as any).id,
                voucher_id: voucherId,
                title,
                description: description || null,
                failure_cost_cents: failureCostCents,
                required_pomo_minutes: requiredPomoInput.requiredPomoMinutes,
                requires_proof: finalRequiresProof,
                rule_config: ruleConfig,
                timezone: userTimezone,
                google_sync_for_rule: titleSelection.googleSyncForTask,
                google_event_duration_minutes: eventDurationMinutes,
                google_event_color_id: googleEventColorId,
                manual_reminder_offsets_ms: manualReminderOffsetsMs,
                last_generated_date: new Intl.DateTimeFormat("en-CA", {
                    timeZone: userTimezone,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }).format(initialDeadlineDate)
            })
            .select()
            .single();

        if (ruleError) {
            return { error: "Failed to create recurrence rule: " + ruleError.message };
        }
        recurrenceRuleId = (rule as any).id;
    }

    // @ts-ignore
    const { data: task, error } = await (supabase.from("tasks" as any) as any)
        .insert({
            user_id: (user as any).id,
            voucher_id: voucherId,
            title,
            creation_input: parserSourceTitle,
            description: description || null,
            failure_cost_cents: failureCostCents,
            required_pomo_minutes: requiredPomoInput.requiredPomoMinutes,
            requires_proof: finalRequiresProof,
            deadline: validatedDeadline.toISOString(),
            status: shouldAutoCompletePastEvent ? "ACCEPTED" : "ACTIVE",
            marked_completed_at: shouldAutoCompletePastEvent ? creationNowIso : null,
            voucher_response_deadline: null,
            start_at: titleSelection.isStrict ? eventStartAtIso : null,
            is_strict: titleSelection.isStrict,
            google_sync_for_task: titleSelection.googleSyncForTask,
            google_event_start_at: eventStartAtIso,
            google_event_end_at: eventEndAtIso,
            google_event_color_id: googleEventColorId,
            recurrence_rule_id: recurrenceRuleId,
            created_by_user_client_instance_id: actorUserClientInstanceId,
        })
        .select()
        .single();

    if (error) {
        return { error: error.message };
    }

    const reminderInsert = await insertTaskReminders(
        supabase,
        (user as any).id,
        (task as any).id,
        remindersInput.reminderDates
    );
    if (reminderInsert.error) {
        return { error: reminderInsert.error };
    }

    const seededDefaultReminders = buildDefaultDeadlineReminderRows({
        parentTaskId: (task as any).id,
        userId: (user as any).id,
        deadline: validatedDeadline,
        deadlineOneHourWarningEnabled:
            ((reminderDefaultsProfile as any)?.deadline_one_hour_warning_enabled as boolean | undefined) ?? true,
        deadlineFinalWarningEnabled:
            ((reminderDefaultsProfile as any)?.deadline_final_warning_enabled as boolean | undefined) ?? true,
        now: new Date(),
    });
    const seededReminderInsert = await insertTaskReminderRows(
        supabase,
        seededDefaultReminders,
        { ignoreDuplicates: true }
    );
    if (seededReminderInsert.error) {
        return { error: seededReminderInsert.error };
    }

    if (!shouldAutoCompletePastEvent) {
        const subtaskInsert = await insertTaskSubtasks(
            supabase,
            (user as any).id,
            (task as any).id,
            subtasksInput.titles
        );
        if (subtaskInsert.error) {
            return { error: subtaskInsert.error };
        }
    }

    // @ts-ignore
    const taskEvents: Array<Record<string, unknown>> = [{
        task_id: (task as any).id,
        event_type: "ACTIVE",
        actor_id: (user as any).id,
        actor_user_client_instance_id: actorUserClientInstanceId,
        from_status: "ACTIVE",
        to_status: "ACTIVE",
        metadata: {
            title,
            deadline: validatedDeadline.toISOString(),
            failure_cost_cents: failureCostCents,
            recurrence_rule_id: recurrenceRuleId,
            reminder_count: remindersInput.reminderDates.length,
            required_pomo_minutes: requiredPomoInput.requiredPomoMinutes,
            requires_proof: finalRequiresProof,
        },
    }];
    if (shouldAutoCompletePastEvent) {
        taskEvents.push({
            task_id: (task as any).id,
            event_type: "MARK_COMPLETE",
            actor_id: (user as any).id,
            actor_user_client_instance_id: actorUserClientInstanceId,
            from_status: "ACTIVE",
            to_status: "ACCEPTED",
            metadata: {
                auto_completed_past_event: true,
                auto_accepted: true,
            },
        });
    }
    await supabase.from("task_events").insert(taskEvents as any);

    await enqueueGoogleCalendarUpsert((user as any).id, (task as any).id);

    invalidatePendingVoucherRequestsCache(voucherId);
    revalidatePath("/friends");
    revalidateTaskSurfaces((task as any).id, (user as any).id);
    return {
        success: true,
        taskId: (task as any).id,
        recurrenceRuleId,
    };
}
