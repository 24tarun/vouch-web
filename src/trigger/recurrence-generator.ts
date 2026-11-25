import { schedules } from "@trigger.dev/sdk/v3";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RecurrenceRule } from "@/lib/types";
import {
    buildDefaultDeadlineReminderRows,
    MANUAL_REMINDER_SOURCE,
} from "@/lib/task-reminder-defaults";
import { isGoogleEventColorId } from "@/lib/task-title-event-color";
import { enqueueGoogleCalendarOutbox } from "@/lib/google-calendar/sync";
import { SYSTEM_ACTOR_PROFILE_ID } from "@/lib/system-actor";
import { isRecurrenceDateAlreadyGenerated } from "@/lib/recurrence-cursor";
import {
    addLocalDays,
    buildTimeZoneContext,
    shouldRunForLocalDate,
    recurrenceAnchorLocalDate,
    toDateStr,
} from "@/lib/recurrence-schedule";

export const recurrenceGenerator = schedules.task({
    id: "recurrence-generator",
    cron: "0 * * * *",
    run: async (payload, { ctx }) => {
        const supabase = createAdminClient();
        console.log("Starting recurrence generator check...");

        const { data: rules, error } = await supabase
            .from("recurrence_rules")
            .select(
                "id, user_id, voucher_id, title, description, failure_cost_cents, required_pomo_minutes, requires_proof, rule_config, timezone, last_generated_date, paused_at, created_at, manual_reminder_offsets_ms, alarm_reminder_offsets_ms, google_sync_for_rule, time_bound_for_rule, window_start_offset_minutes, google_event_duration_minutes, google_event_color_id"
            )
            .is("paused_at", null) as { data: RecurrenceRule[] | null, error: any };

        if (error) {
            console.error("Failed to fetch recurrence rules:", error);
            return;
        }

        if (!rules || rules.length === 0) {
            console.log("No recurrence rules found.");
            return;
        }

        console.log(`Processing ${rules.length} recurrence rules...`);
        let generatedCount = 0;
        const reminderDefaultsByUser = new Map<
            string,
            { deadlineOneHourWarningEnabled: boolean; deadlineFinalWarningEnabled: boolean; deadlineDueWarningEnabled: boolean }
        >();

        for (const rule of rules) {
            try {
                await processRule(rule, supabase, reminderDefaultsByUser);
                generatedCount++;
            } catch (err) {
                console.error(`Error processing rule ${rule.id}:`, err);
            }
        }

        console.log(`Recurrence generator finished. Generated/Processed count check complete.`);
    },
});

async function getLatestReminderOffsetsForRule(
    recurrenceRuleId: string,
    supabase: any
): Promise<number[]> {
    const { data: latestTask, error: latestTaskError } = await (supabase
        .from("tasks") as any)
        .select("id, deadline")
        .eq("recurrence_rule_id", recurrenceRuleId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (latestTaskError || !latestTask?.id || !latestTask?.deadline) {
        if (latestTaskError) {
            console.error(`Failed to load latest task for recurrence rule ${recurrenceRuleId}:`, latestTaskError);
        }
        return [];
    }

    const latestDeadlineMs = new Date(latestTask.deadline).getTime();
    if (Number.isNaN(latestDeadlineMs)) {
        return [];
    }

    const { data: latestReminders, error: remindersError } = await (supabase
        .from("task_reminders") as any)
        .select("reminder_at, source")
        .eq("parent_task_id", latestTask.id as any)
        .eq("source", MANUAL_REMINDER_SOURCE as any)
        .order("reminder_at", { ascending: true });

    if (remindersError) {
        console.error(`Failed to load reminders for latest task of rule ${recurrenceRuleId}:`, remindersError);
        return [];
    }

    const offsets = new Set<number>();
    for (const row of ((latestReminders as Array<{ reminder_at: string }> | null) || [])) {
        const reminderMs = new Date(row.reminder_at).getTime();
        if (Number.isNaN(reminderMs)) continue;
        offsets.add(reminderMs - latestDeadlineMs);
    }

    return Array.from(offsets.values()).sort((a, b) => a - b);
}

function sanitizeManualReminderOffsets(rawOffsets: unknown): number[] {
    if (!Array.isArray(rawOffsets)) return [];

    const offsets = new Set<number>();
    for (const value of rawOffsets) {
        if (typeof value !== "number") continue;
        if (!Number.isFinite(value)) continue;
        if (value > 0) continue;
        offsets.add(value);
    }

    return Array.from(offsets.values()).sort((a, b) => a - b);
}

function sanitizeAlarmReminderOffsets(rawOffsets: unknown): number[] {
    return sanitizeManualReminderOffsets(rawOffsets);
}

async function getReminderOffsetsForRule(
    rule: RecurrenceRule,
    supabase: any
): Promise<number[]> {
    if (rule.manual_reminder_offsets_ms != null) {
        return sanitizeManualReminderOffsets(rule.manual_reminder_offsets_ms);
    }

    return getLatestReminderOffsetsForRule(rule.id, supabase);
}

async function insertGeneratedReminders(
    supabase: any,
    taskId: string,
    userId: string,
    deadlineIso: string,
    reminderOffsetsMs: number[],
    alarmOffsetsMs: Set<number>
) {
    if (reminderOffsetsMs.length === 0) return;

    const nowMs = Date.now();
    const deadlineMs = new Date(deadlineIso).getTime();
    if (Number.isNaN(deadlineMs)) return;

    const reminderIsoSet = new Set<string>();
    for (const offsetMs of reminderOffsetsMs) {
        const reminderMs = deadlineMs + offsetMs;
        if (reminderMs <= nowMs) continue;
        if (reminderMs > deadlineMs) continue;
        reminderIsoSet.add(new Date(reminderMs).toISOString());
    }

    const reminderIsos = Array.from(reminderIsoSet.values()).sort(
        (a, b) => new Date(a).getTime() - new Date(b).getTime()
    );

    if (reminderIsos.length === 0) return;
    const nowIso = new Date().toISOString();

    const { error } = await (supabase.from("task_reminders") as any).insert(
        reminderIsos.map((reminderIso) => ({
            parent_task_id: taskId,
            user_id: userId,
            reminder_at: reminderIso,
            source: MANUAL_REMINDER_SOURCE,
            alarm_enabled: alarmOffsetsMs.has(new Date(reminderIso).getTime() - deadlineMs),
            notified_at: null,
            created_at: nowIso,
            updated_at: nowIso,
        }))
    );

    if (error) {
        console.error(`Failed to insert copied reminders for task ${taskId}:`, error);
    }
}

async function getReminderDefaultsForUser(
    supabase: any,
    userId: string,
    reminderDefaultsByUser: Map<string, { deadlineOneHourWarningEnabled: boolean; deadlineFinalWarningEnabled: boolean; deadlineDueWarningEnabled: boolean }>
) {
    const cached = reminderDefaultsByUser.get(userId);
    if (cached) return cached;

    const { data: profile } = await (supabase.from("profiles") as any)
        .select("deadline_one_hour_warning_enabled, deadline_final_warning_enabled, deadline_due_warning_enabled")
        .eq("id", userId as any)
        .maybeSingle();

    const defaults = {
        deadlineOneHourWarningEnabled:
            (profile?.deadline_one_hour_warning_enabled as boolean | undefined) ?? true,
        deadlineFinalWarningEnabled:
            (profile?.deadline_final_warning_enabled as boolean | undefined) ?? true,
        deadlineDueWarningEnabled:
            (profile?.deadline_due_warning_enabled as boolean | undefined) ?? true,
    };
    reminderDefaultsByUser.set(userId, defaults);
    return defaults;
}

async function insertDefaultDeadlineRemindersForGeneratedTask(
    supabase: any,
    taskId: string,
    userId: string,
    deadlineIso: string,
    reminderDefaultsByUser: Map<string, { deadlineOneHourWarningEnabled: boolean; deadlineFinalWarningEnabled: boolean; deadlineDueWarningEnabled: boolean }>,
    alarmOffsetsMs: Set<number>
) {
    const defaults = await getReminderDefaultsForUser(supabase, userId, reminderDefaultsByUser);
    const seededRows = buildDefaultDeadlineReminderRows({
        parentTaskId: taskId,
        userId,
        deadline: new Date(deadlineIso),
        deadlineOneHourWarningEnabled: defaults.deadlineOneHourWarningEnabled,
        deadlineFinalWarningEnabled: defaults.deadlineFinalWarningEnabled,
        deadlineDueWarningEnabled: defaults.deadlineDueWarningEnabled,
        now: new Date(),
    });
    if (seededRows.length === 0) return;
    const nowIso = new Date().toISOString();
    const deadlineMs = new Date(deadlineIso).getTime();
    const seededRowsWithTimestamps = seededRows.map((row) => ({
        ...row,
        alarm_enabled: alarmOffsetsMs.has(new Date(row.reminder_at).getTime() - deadlineMs),
        created_at: row.created_at ?? nowIso,
        updated_at: row.updated_at ?? nowIso,
    }));

    const { error } = await (supabase.from("task_reminders") as any).upsert(
        seededRowsWithTimestamps,
        {
            onConflict: "parent_task_id,reminder_at",
            ignoreDuplicates: true,
        }
    );
    if (error) {
        console.error(`Failed to seed default reminders for generated task ${taskId}:`, error);
    }
}

async function applyGeneratedAlarmOffsets(
    supabase: any,
    taskId: string,
    deadlineIso: string,
    alarmOffsetsMs: Set<number>
) {
    if (alarmOffsetsMs.size === 0) return;

    const deadlineMs = new Date(deadlineIso).getTime();
    if (!Number.isFinite(deadlineMs)) return;

    const { data: reminders, error } = await (supabase.from("task_reminders") as any)
        .select("id, reminder_at")
        .eq("parent_task_id", taskId);
    if (error) {
        console.error(`Failed to load generated reminders for task ${taskId}:`, error);
        return;
    }

    const alarmReminderIds = ((reminders as Array<{ id: string; reminder_at: string }> | null) || [])
        .filter((reminder) => {
            const reminderMs = new Date(reminder.reminder_at).getTime();
            return Number.isFinite(reminderMs) && alarmOffsetsMs.has(reminderMs - deadlineMs);
        })
        .map((reminder) => reminder.id);
    if (alarmReminderIds.length === 0) return;

    const { error: updateError } = await (supabase.from("task_reminders") as any)
        .update({ alarm_enabled: true })
        .in("id", alarmReminderIds);
    if (updateError) {
        console.error(`Failed to apply generated reminder alarms for task ${taskId}:`, updateError);
    }
}

async function processRule(
    rule: RecurrenceRule,
    supabase: any,
    reminderDefaultsByUser: Map<string, { deadlineOneHourWarningEnabled: boolean; deadlineFinalWarningEnabled: boolean; deadlineDueWarningEnabled: boolean }>
) {
    if (rule.paused_at) return;

    const { frequency, interval, days_of_week, time_of_day } = rule.rule_config;
    const timezone = rule.timezone || "UTC";
    const normalizedInterval = Number.isFinite(interval) && interval > 0 ? Math.floor(interval) : 1;

    const { getLocalDateParts, resolveUtcForLocalDateTime } = buildTimeZoneContext(timezone);

    const now = new Date();
    const currentLocalParts = getLocalDateParts(now);
    const currentLocalDateStr = toDateStr(currentLocalParts);
    const anchorLocalDateStr = recurrenceAnchorLocalDate(rule, getLocalDateParts);

    if (isRecurrenceDateAlreadyGenerated(rule.last_generated_date, currentLocalDateStr)) {
        return;
    }

    const shouldRun = shouldRunForLocalDate(
        frequency,
        normalizedInterval,
        days_of_week,
        anchorLocalDateStr,
        currentLocalDateStr
    );
    if (shouldRun) {
        console.log(`Generating task for rule ${rule.id} on ${currentLocalDateStr}`);
        const reminderOffsetsMs = await getReminderOffsetsForRule(rule, supabase);
        const alarmOffsetsMs = new Set(sanitizeAlarmReminderOffsets(rule.alarm_reminder_offsets_ms));

        const [hours, minutes] = time_of_day.split(":").map(Number);
        const deadlineDateParts = hours === 0 && minutes === 0
            ? addLocalDays(currentLocalParts, 1)
            : currentLocalParts;
        const deadlineIso = resolveUtcForLocalDateTime(deadlineDateParts, hours, minutes);
        const windowStartOffsetMinutes = Number(
            (rule as any).window_start_offset_minutes ?? (rule as any).google_event_duration_minutes
        );
        const hasWindowStartOffset =
            Number.isFinite(windowStartOffsetMinutes) &&
            windowStartOffsetMinutes > 0;
        const eventStartIso = hasWindowStartOffset
            ? new Date(new Date(deadlineIso).getTime() - windowStartOffsetMinutes * 60 * 1000).toISOString()
            : null;

        const { data: existingTask, error: existingTaskError } = await supabase
            .from("tasks")
            .select("id")
            .eq("recurrence_rule_id", rule.id)
            .eq("deadline", deadlineIso)
            .limit(1)
            .maybeSingle();

        if (existingTaskError) {
            console.error(`Failed to check existing occurrence for recurrence rule ${rule.id}:`, existingTaskError);
            return;
        }

        if (existingTask?.id) {
            await supabase.from("recurrence_rules")
                .update({ last_generated_date: currentLocalDateStr, updated_at: new Date().toISOString() })
                .eq("id", rule.id)
                .or(`last_generated_date.is.null,last_generated_date.lt.${currentLocalDateStr}`);
            return;
        }

        const { data: createdTask, error: insertError } = await (supabase.from("tasks") as any)
            .insert({
                user_id: rule.user_id,
                voucher_id: rule.voucher_id,
                title: rule.title,
                description: rule.description,
                failure_cost_cents: rule.failure_cost_cents,
                required_pomo_minutes: rule.required_pomo_minutes ?? null,
                requires_proof: Boolean(rule.requires_proof),
                deadline: deadlineIso,
                status: "ACTIVE",
                start_at: Boolean((rule as any).time_bound_for_rule) ? eventStartIso : null,
                is_strict: Boolean((rule as any).time_bound_for_rule),
                google_sync_for_task: Boolean(rule.google_sync_for_rule),
                google_event_start_at: Boolean(rule.google_sync_for_rule) ? eventStartIso : null,
                google_event_end_at: Boolean(rule.google_sync_for_rule) ? deadlineIso : null,
                google_event_color_id:
                    Boolean(rule.google_sync_for_rule) &&
                        isGoogleEventColorId((rule as any).google_event_color_id)
                        ? (rule as any).google_event_color_id
                        : null,
                recurrence_rule_id: rule.id
            })
            .select("id, deadline")
            .single();

        if (insertError) {
            console.error("Failed to insert task:", insertError);
            return;
        }

        if (createdTask?.id) {
            const { error: createdEventError } = await (supabase.from("task_events") as any).insert({
                task_id: createdTask.id,
                event_type: "ACTIVE",
                actor_id: SYSTEM_ACTOR_PROFILE_ID,
                from_status: "ACTIVE",
                to_status: "ACTIVE",
                metadata: {
                    source: "recurrence_generator",
                    recurrence_rule_id: rule.id,
                    generated_local_date: currentLocalDateStr,
                    deadline: createdTask.deadline || deadlineIso,
                },
            });

            if (createdEventError) {
                console.error(`Failed to insert ACTIVE event for generated task ${createdTask.id}:`, createdEventError);
            }
        }

        if (createdTask?.id) {
            await insertGeneratedReminders(
                supabase,
                createdTask.id,
                rule.user_id,
                createdTask.deadline || deadlineIso,
                reminderOffsetsMs,
                alarmOffsetsMs
            );
            await insertDefaultDeadlineRemindersForGeneratedTask(
                supabase,
                createdTask.id,
                rule.user_id,
                createdTask.deadline || deadlineIso,
                reminderDefaultsByUser,
                alarmOffsetsMs
            );
            await applyGeneratedAlarmOffsets(
                supabase,
                createdTask.id,
                createdTask.deadline || deadlineIso,
                alarmOffsetsMs
            );
            if (rule.google_sync_for_rule) {
                await enqueueGoogleCalendarOutbox(rule.user_id, createdTask.id, "UPSERT");
            }
        }

        await supabase.from("recurrence_rules")
            .update({ last_generated_date: currentLocalDateStr, updated_at: new Date().toISOString() })
            .eq("id", rule.id)
            .or(`last_generated_date.is.null,last_generated_date.lt.${currentLocalDateStr}`);

        console.log(`Successfully generated task for rule ${rule.id}`);
    }
}
