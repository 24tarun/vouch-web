/**
 * Trigger: recurrence-generator
 * Runs: Every hour at minute 0 (`0 * * * *`).
 * What it does when it runs:
 * 1) Loads all recurrence_rules (table only stores active rules).
 * 2) For each rule, evaluates whether a task should be generated for the current date in the rule's timezone.
 * 3) If due, creates a new ACTIVE task using the rule settings (title, voucher, cost, deadline, recurrence_rule_id).
 * 4) Updates recurrence_rules.last_generated_date so the same date is not generated twice.
 */
import { schedules } from "@trigger.dev/sdk/v3";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RecurrenceRule, RecurrenceRuleConfig } from "@/lib/types";
import {
    buildDefaultDeadlineReminderRows,
    MANUAL_REMINDER_SOURCE,
} from "@/lib/task-reminder-defaults";
import { isGoogleEventColorId } from "@/lib/task-title-event-color";
import { enqueueGoogleCalendarOutbox } from "@/lib/google-calendar/sync";
import { SYSTEM_ACTOR_PROFILE_ID } from "@/lib/system-actor";

type DateParts = { year: number; month: number; day: number };

function toDateStr(parts: DateParts): string {
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function ymdToUtcMidnightMs(ymd: string): number {
    const [y, m, d] = ymd.split("-").map(Number);
    return Date.UTC(y, m - 1, d, 0, 0, 0, 0);
}

function localDayOfWeek(ymd: string): number {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function monthDiffFrom(fromYmd: string, toYmd: string): number {
    const [fy, fm] = fromYmd.split("-").map(Number);
    const [ty, tm] = toYmd.split("-").map(Number);
    return (ty - fy) * 12 + (tm - fm);
}

function yearDiffFrom(fromYmd: string, toYmd: string): number {
    const [fy] = fromYmd.split("-").map(Number);
    const [ty] = toYmd.split("-").map(Number);
    return ty - fy;
}

function buildTimeZoneContext(timezone: string) {
    const localDateFormatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    const localDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });

    const getLocalDateParts = (value: Date): DateParts => {
        const parts = localDateFormatter.formatToParts(value);
        const map: Record<string, string> = {};
        for (const part of parts) {
            if (part.type !== "literal") map[part.type] = part.value;
        }
        return {
            year: Number(map.year),
            month: Number(map.month),
            day: Number(map.day),
        };
    };

    const resolveUtcForLocalDateTime = (
        dateParts: DateParts,
        hour: number,
        minute: number
    ): string => {
        const targetWall = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, hour, minute, 0, 0);
        let guess = targetWall;
        for (let i = 0; i < 6; i++) {
            const rendered = localDateTimeFormatter.formatToParts(new Date(guess));
            const map: Record<string, string> = {};
            for (const part of rendered) {
                if (part.type !== "literal") map[part.type] = part.value;
            }
            const wallAtGuess = Date.UTC(
                Number(map.year),
                Number(map.month) - 1,
                Number(map.day),
                Number(map.hour),
                Number(map.minute),
                Number(map.second),
                0
            );
            const diff = wallAtGuess - targetWall;
            if (Math.abs(diff) < 1000) break;
            guess -= diff;
        }
        return new Date(guess).toISOString();
    };

    return { getLocalDateParts, resolveUtcForLocalDateTime };
}

function shouldRunForLocalDate(
    frequency: RecurrenceRuleConfig["frequency"],
    interval: number,
    daysOfWeek: number[] | null | undefined,
    createdLocalDateStr: string,
    currentLocalDateStr: string
): boolean {
    const anchorDayMs = ymdToUtcMidnightMs(createdLocalDateStr);
    const currentDayMs = ymdToUtcMidnightMs(currentLocalDateStr);
    const daysFromAnchor = Math.floor((currentDayMs - anchorDayMs) / (24 * 60 * 60 * 1000));
    if (daysFromAnchor < 0) return false;

    switch (frequency) {
        case "DAILY":
            return daysFromAnchor % interval === 0;
        case "WEEKLY": {
            const allowedDays = Array.isArray(daysOfWeek) ? daysOfWeek : [];
            const weekday = localDayOfWeek(currentLocalDateStr);
            if (!allowedDays.includes(weekday)) return false;
            const anchorWeekStart = anchorDayMs - localDayOfWeek(createdLocalDateStr) * 24 * 60 * 60 * 1000;
            const currentWeekStart = currentDayMs - weekday * 24 * 60 * 60 * 1000;
            const weeksFromAnchor = Math.floor((currentWeekStart - anchorWeekStart) / (7 * 24 * 60 * 60 * 1000));
            return weeksFromAnchor >= 0 && (weeksFromAnchor % interval === 0);
        }
        case "WEEKDAYS": {
            const day = localDayOfWeek(currentLocalDateStr);
            return day >= 1 && day <= 5;
        }
        case "MONTHLY": {
            const [, , currentDay] = currentLocalDateStr.split("-").map(Number);
            const [, , anchorDay] = createdLocalDateStr.split("-").map(Number);
            const months = monthDiffFrom(createdLocalDateStr, currentLocalDateStr);
            return currentDay === anchorDay && months >= 0 && months % interval === 0;
        }
        case "YEARLY": {
            const [, currentMonth, currentDay] = currentLocalDateStr.split("-").map(Number);
            const [, anchorMonth, anchorDay] = createdLocalDateStr.split("-").map(Number);
            const years = yearDiffFrom(createdLocalDateStr, currentLocalDateStr);
            return (
                currentMonth === anchorMonth &&
                currentDay === anchorDay &&
                years >= 0 &&
                years % interval === 0
            );
        }
        case "CUSTOM":
            return daysFromAnchor % interval === 0;
        default:
            return false;
    }
}

export const recurrenceGenerator = schedules.task({
    id: "recurrence-generator",
    cron: "0 * * * *", // Run every hour at minute 0
    run: async (payload, { ctx }) => {
        const supabase = createAdminClient();
        console.log("Starting recurrence generator check...");

        // Fetch recurrence rules (table only stores active rules)
        // @ts-ignore
        const { data: rules, error } = await supabase
            .from("recurrence_rules")
            .select(
                "id, user_id, voucher_id, title, description, failure_cost_cents, required_pomo_minutes, requires_proof, rule_config, timezone, last_generated_date, created_at, manual_reminder_offsets_ms, google_sync_for_rule, time_bound_for_rule, window_start_offset_minutes, google_event_duration_minutes, google_event_color_id"
            ) as { data: RecurrenceRule[] | null, error: any };

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
            { deadlineOneHourWarningEnabled: boolean; deadlineFinalWarningEnabled: boolean }
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
    reminderOffsetsMs: number[]
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
    reminderDefaultsByUser: Map<string, { deadlineOneHourWarningEnabled: boolean; deadlineFinalWarningEnabled: boolean }>
) {
    const cached = reminderDefaultsByUser.get(userId);
    if (cached) return cached;

    const { data: profile } = await (supabase.from("profiles") as any)
        .select("deadline_one_hour_warning_enabled, deadline_final_warning_enabled")
        .eq("id", userId as any)
        .maybeSingle();

    const defaults = {
        deadlineOneHourWarningEnabled:
            (profile?.deadline_one_hour_warning_enabled as boolean | undefined) ?? true,
        deadlineFinalWarningEnabled:
            (profile?.deadline_final_warning_enabled as boolean | undefined) ?? true,
    };
    reminderDefaultsByUser.set(userId, defaults);
    return defaults;
}

async function insertDefaultDeadlineRemindersForGeneratedTask(
    supabase: any,
    taskId: string,
    userId: string,
    deadlineIso: string,
    reminderDefaultsByUser: Map<string, { deadlineOneHourWarningEnabled: boolean; deadlineFinalWarningEnabled: boolean }>
) {
    const defaults = await getReminderDefaultsForUser(supabase, userId, reminderDefaultsByUser);
    const seededRows = buildDefaultDeadlineReminderRows({
        parentTaskId: taskId,
        userId,
        deadline: new Date(deadlineIso),
        deadlineOneHourWarningEnabled: defaults.deadlineOneHourWarningEnabled,
        deadlineFinalWarningEnabled: defaults.deadlineFinalWarningEnabled,
        now: new Date(),
    });
    if (seededRows.length === 0) return;
    const nowIso = new Date().toISOString();
    const seededRowsWithTimestamps = seededRows.map((row) => ({
        ...row,
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

async function processRule(
    rule: RecurrenceRule,
    supabase: any,
    reminderDefaultsByUser: Map<string, { deadlineOneHourWarningEnabled: boolean; deadlineFinalWarningEnabled: boolean }>
) {
    const { frequency, interval, days_of_week, time_of_day } = rule.rule_config;
    const timezone = rule.timezone || "UTC";
    const normalizedInterval = Number.isFinite(interval) && interval > 0 ? Math.floor(interval) : 1;

    const { getLocalDateParts, resolveUtcForLocalDateTime } = buildTimeZoneContext(timezone);

    const now = new Date();
    const currentLocalParts = getLocalDateParts(now);
    const currentLocalDateStr = toDateStr(currentLocalParts);
    const createdLocalDateStr = toDateStr(getLocalDateParts(new Date(rule.created_at)));

    if (rule.last_generated_date === currentLocalDateStr) {
        return;
    }

    const shouldRun = shouldRunForLocalDate(
        frequency,
        normalizedInterval,
        days_of_week,
        createdLocalDateStr,
        currentLocalDateStr
    );
    if (shouldRun) {
        console.log(`Generating task for rule ${rule.id} on ${currentLocalDateStr}`);
        const reminderOffsetsMs = await getReminderOffsetsForRule(rule, supabase);

        const [hours, minutes] = time_of_day.split(":").map(Number);
        const deadlineIso = resolveUtcForLocalDateTime(currentLocalParts, hours, minutes);
        const windowStartOffsetMinutes = Number(
            (rule as any).window_start_offset_minutes ?? (rule as any).google_event_duration_minutes
        );
        const hasWindowStartOffset =
            Number.isFinite(windowStartOffsetMinutes) &&
            windowStartOffsetMinutes > 0;
        const eventStartIso = hasWindowStartOffset
            ? new Date(new Date(deadlineIso).getTime() - windowStartOffsetMinutes * 60 * 1000).toISOString()
            : null;

        // Create Task
        // @ts-ignore
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
                reminderOffsetsMs
            );
            await insertDefaultDeadlineRemindersForGeneratedTask(
                supabase,
                createdTask.id,
                rule.user_id,
                createdTask.deadline || deadlineIso,
                reminderDefaultsByUser
            );
            if (rule.google_sync_for_rule) {
                await enqueueGoogleCalendarOutbox(rule.user_id, createdTask.id, "UPSERT");
            }
        }

        // Update Rule
        // @ts-ignore
        await supabase.from("recurrence_rules")
            .update({ last_generated_date: currentLocalDateStr, updated_at: new Date().toISOString() })
            .eq("id", rule.id);

        console.log(`Successfully generated task for rule ${rule.id}`);
    }
}
