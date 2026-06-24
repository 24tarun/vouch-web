/**
 * Trigger: task-reminder-notify
 * Runs: Every minute (`* * * * *`).
 * What it does when it runs:
 * 1) Finds due task reminders that were not notified yet.
 * 2) Writes deadline warning task events for seeded default reminders.
 * 3) Marks reminders as notified to avoid duplicate sends.
 */
import { schedules } from "@trigger.dev/sdk/v3";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendExpoDataPushToUser } from "@/lib/expo-push";
import { sendNotification } from "@/lib/notifications";
import type { TaskStatus } from "@/lib/xstate/task-machine";
import {
    DEFAULT_DEADLINE_1H_REMINDER_SOURCE,
    DEFAULT_DEADLINE_10M_REMINDER_SOURCE,
    DEFAULT_DEADLINE_DUE_REMINDER_SOURCE,
    MANUAL_REMINDER_SOURCE,
} from "@/lib/task-reminder-defaults";
import { SYSTEM_ACTOR_PROFILE_ID } from "@/lib/system-actor";
import { claimRowsByIdsWithTimestamp, rollbackClaimByTimestamp } from "@/trigger/claim-utils";

export interface DueReminder {
    id: string;
    parent_task_id: string;
    user_id: string;
    reminder_at: string;
    source: string;
}

export interface ReminderTask {
    id: string;
    title: string;
    status: TaskStatus;
    user_id: string;
}

export interface ReminderNotificationEntry {
    reminder: DueReminder;
    task: ReminderTask;
    eventType: string | null;
}

export interface ReminderNotificationGroup {
    key: string;
    userId: string;
    source: string;
    reminderAtMinute: string;
    entries: ReminderNotificationEntry[];
}

const ACTIVE_STATUSES: TaskStatus[] = ["ACTIVE", "POSTPONED"];
const ONE_HOUR_REMINDER_EVENT = "DEADLINE_WARNING_1H";
const TEN_MIN_REMINDER_EVENT = "DEADLINE_WARNING_10M";
const DUE_REMINDER_EVENT = "DEADLINE_WARNING_DUE";
const NOTIFICATION_TTL_MS = 30 * 60 * 1000;

export function isReminderTaskActive(task: ReminderTask): boolean {
    return ACTIVE_STATUSES.includes(task.status);
}

function getReminderEventType(source: string): string | null {
    if (source === DEFAULT_DEADLINE_1H_REMINDER_SOURCE) return ONE_HOUR_REMINDER_EVENT;
    if (source === DEFAULT_DEADLINE_10M_REMINDER_SOURCE) return TEN_MIN_REMINDER_EVENT;
    if (source === DEFAULT_DEADLINE_DUE_REMINDER_SOURCE) return DUE_REMINDER_EVENT;
    return null;
}

export function getReminderAtMinuteKey(reminderAt: string): string {
    const reminderDate = new Date(reminderAt);
    const reminderMs = reminderDate.getTime();
    if (!Number.isFinite(reminderMs)) return reminderAt;

    reminderDate.setUTCSeconds(0, 0);
    return reminderDate.toISOString();
}

export function groupReminderNotificationEntries(
    entries: ReminderNotificationEntry[]
): ReminderNotificationGroup[] {
    const groupsByKey = new Map<string, ReminderNotificationGroup>();

    for (const entry of entries) {
        const reminderAtMinute = getReminderAtMinuteKey(entry.reminder.reminder_at);
        const key = [
            entry.reminder.user_id,
            entry.reminder.source,
            reminderAtMinute,
        ].join("|");

        const existingGroup = groupsByKey.get(key);
        if (existingGroup) {
            existingGroup.entries.push(entry);
            continue;
        }

        groupsByKey.set(key, {
            key,
            userId: entry.reminder.user_id,
            source: entry.reminder.source,
            reminderAtMinute,
            entries: [entry],
        });
    }

    return Array.from(groupsByKey.values());
}

export function getReminderLocalBackupKey(group: ReminderNotificationGroup): string {
    if (group.entries.length === 1) {
        return group.entries[0].reminder.id;
    }

    return `aggregate|${group.source}|${group.reminderAtMinute}`;
}

export function buildReminderRemoteDeliveryMarkerData(group: ReminderNotificationGroup) {
    return {
        kind: "TASK_REMINDER_REMOTE_DELIVERED",
        category: "DEADLINE_REMINDER",
        localBackupKey: getReminderLocalBackupKey(group),
        taskIds: group.entries.map((entry) => entry.task.id),
        reminderIds: group.entries.map((entry) => entry.reminder.id),
        count: group.entries.length,
        source: group.source,
        reminderAt: group.reminderAtMinute,
        aggregate: group.entries.length > 1,
    };
}

export function buildReminderNotificationParams(
    group: ReminderNotificationGroup
): Parameters<typeof sendNotification>[0] {
    const [firstEntry] = group.entries;
    if (!firstEntry) {
        throw new Error("Cannot build reminder notification for an empty group.");
    }

    const { reminder, task, eventType } = firstEntry;
    const isDue = reminder.source === DEFAULT_DEADLINE_DUE_REMINDER_SOURCE;
    const isOneHour = reminder.source === DEFAULT_DEADLINE_1H_REMINDER_SOURCE;

    if (group.entries.length === 1) {
        if (reminder.source === MANUAL_REMINDER_SOURCE) {
            return {
                userId: reminder.user_id,
                title: "Task reminder",
                text: `Reminder for "${task.title}".`,
                email: false,
                push: true,
                url: `/tasks/${task.id}`,
                tag: `task-reminder-${reminder.id}`,
                data: {
                    taskId: task.id,
                    reminderId: reminder.id,
                    localBackupKey: getReminderLocalBackupKey(group),
                    kind: "TASK_REMINDER",
                    category: "DEADLINE_REMINDER",
                    reminderAt: reminder.reminder_at,
                },
            };
        }

        const title = isDue
            ? "Final call"
            : isOneHour
                ? "Deadline in 1 hour"
                : "Deadline in 10 minutes";
        const text = isDue
            ? `Mark "${task.title}" complete now or it will be missed.`
            : isOneHour
                ? `1 hour left for ${task.title}`
                : `10 minutes left for ${task.title}`;

        return {
            userId: reminder.user_id,
            subject: title,
            title,
            text,
            email: false,
            push: true,
            url: `/tasks/${task.id}`,
            tag: `deadline-reminder-${reminder.id}`,
            data: {
                taskId: task.id,
                reminderId: reminder.id,
                localBackupKey: getReminderLocalBackupKey(group),
                kind: isDue ? "DEADLINE_FINAL_CALL" : (eventType || "DEADLINE_WARNING"),
                category: "DEADLINE_REMINDER",
                reminderAt: reminder.reminder_at,
                source: reminder.source,
            },
        };
    }

    const count = group.entries.length;
    const title = isDue ? "Final call" : "Task reminders";
    const text = isDue
        ? `Last call for ${count} tasks.`
        : `${count} tasks need attention.`;
    const tagPrefix = isDue || reminder.source !== MANUAL_REMINDER_SOURCE
        ? "deadline-reminder-aggregate"
        : "task-reminder-aggregate";

    return {
        userId: group.userId,
        subject: title,
        title,
        text,
        email: false,
        push: true,
        url: "/tasks",
        tag: `${tagPrefix}-${group.userId}-${group.source}-${group.reminderAtMinute}`,
        data: {
            aggregate: true,
            localBackupKey: getReminderLocalBackupKey(group),
            taskIds: group.entries.map((entry) => entry.task.id),
            reminderIds: group.entries.map((entry) => entry.reminder.id),
            count,
            source: group.source,
            reminderAt: group.reminderAtMinute,
            url: "/tasks",
            kind: isDue ? "DEADLINE_FINAL_CALL" : "DEADLINE_REMINDER",
            category: "DEADLINE_REMINDER",
        },
    };
}

async function sendRemoteDeliveryMarker(group: ReminderNotificationGroup) {
    try {
        const result = await sendExpoDataPushToUser(group.userId, {
            data: buildReminderRemoteDeliveryMarkerData(group),
            ttlSeconds: 60,
        });

        if (result.success === false) {
            console.warn("[task-reminder-notify] remote delivery marker failed:", {
                groupKey: group.key,
                reason: result.reason,
                failed: result.failed,
            });
        }
    } catch (error) {
        console.warn("[task-reminder-notify] remote delivery marker failed:", {
            groupKey: group.key,
            error,
        });
    }
}

function webNeedsRetry(webResult: {
    total: number;
    delivered: number;
    failed: number;
    skipped?: boolean;
} | null | undefined): boolean {
    if (!webResult) return true;
    if (webResult.skipped) return false;
    if (webResult.total <= 0) return false;
    return webResult.delivered < webResult.total || webResult.failed > 0;
}

async function sendWithWebRetry(params: Parameters<typeof sendNotification>[0]) {
    let result = await sendNotification(params);

    if (!webNeedsRetry(result.push.web)) {
        return result;
    }

    // Best-effort immediate retries for Web Push channel only.
    for (let attempt = 0; attempt < 2; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        result = await sendNotification({
            ...params,
            pushChannels: ["web"],
        });

        if (!webNeedsRetry(result.push.web)) {
            return result;
        }
    }

    return result;
}

async function logDefaultReminderEvent(
    supabase: ReturnType<typeof createAdminClient>,
    task: ReminderTask,
    reminder: DueReminder,
    eventType: string
) {
    const taskEvents = supabase.from("task_events") as unknown as {
        insert: (values: {
            task_id: string;
            event_type: string;
            actor_id: string;
            from_status: TaskStatus;
            to_status: TaskStatus;
            metadata: Record<string, unknown>;
        }) => Promise<unknown>;
    };

    await taskEvents.insert({
        task_id: task.id,
        event_type: eventType,
        actor_id: SYSTEM_ACTOR_PROFILE_ID,
        from_status: task.status,
        to_status: task.status,
        metadata: {
            task_title: task.title.trim(),
            reminder_id: reminder.id,
            reminder_at: reminder.reminder_at,
            source: reminder.source,
        },
    });
}

async function processDueTaskReminders(
    supabase: ReturnType<typeof createAdminClient>,
    nowIso: string
) {
    const dueRemindersResponse = await supabase.from("task_reminders")
        .select("id, parent_task_id, user_id, reminder_at, source")
        .is("notified_at", null)
        .lte("reminder_at", nowIso)
        .order("reminder_at", { ascending: true })
        .limit(500);

    if (dueRemindersResponse.error) {
        console.error("Failed to load due task reminders:", dueRemindersResponse.error);
        return;
    }

    const dueReminders = ((dueRemindersResponse.data as DueReminder[] | null) || []);
    if (dueReminders.length === 0) {
        return;
    }

    const dueReminderIds = dueReminders.map((reminder) => reminder.id);
    const claimIso = new Date().toISOString();
    let claimedReminderIds: string[] = [];
    try {
        const claimedRows = await claimRowsByIdsWithTimestamp("task_reminders", supabase, dueReminderIds, claimIso);
        claimedReminderIds = claimedRows.map((row) => row.id);
    } catch (error) {
        console.error("Failed to claim due task reminders:", error);
        return;
    }
    if (claimedReminderIds.length === 0) return;
    const claimedReminders = dueReminders.filter((row) => claimedReminderIds.includes(row.id));
    if (claimedReminders.length === 0) {
        return;
    }

    const taskIds = Array.from(new Set(claimedReminders.map((reminder) => reminder.parent_task_id)));

    const tasksResponse = await supabase.from("tasks")
        .select("id, title, status, user_id")
        .in("status", ACTIVE_STATUSES)
        .in("id", taskIds);

    if (tasksResponse.error) {
        console.error("Failed to load tasks for due reminders:", tasksResponse.error);
        if (claimedReminderIds.length > 0) {
            try {
                await rollbackClaimByTimestamp("task_reminders", supabase, claimedReminderIds, claimIso);
            } catch (rollbackError) {
                console.error("Failed to rollback claimed reminders after task lookup error:", rollbackError);
            }
        }
        return;
    }

    const tasksById = new Map<string, ReminderTask>();
    for (const task of ((tasksResponse.data as ReminderTask[] | null) || [])) {
        tasksById.set(task.id, task);
    }

    const nowMs = Date.now();
    const remindersToRetry = new Set<string>();
    const dueReminderUserIds = Array.from(new Set(
        claimedReminders
            .filter((reminder) => reminder.source === DEFAULT_DEADLINE_DUE_REMINDER_SOURCE)
            .map((reminder) => reminder.user_id)
    ));
    const dueWarningEnabledByUser = new Map<string, boolean>();
    if (dueReminderUserIds.length > 0) {
        const { data: profileRows, error: profileError } = await supabase
            .from("profiles")
            .select("id, deadline_due_warning_enabled")
            .in("id", dueReminderUserIds);
        if (profileError) {
            console.error("Failed to load final-call notification preferences:", profileError);
        }
        for (const profile of ((profileRows as Array<{ id: string; deadline_due_warning_enabled?: boolean | null }> | null) || [])) {
            dueWarningEnabledByUser.set(profile.id, profile.deadline_due_warning_enabled ?? true);
        }
    }

    const notificationEntries: ReminderNotificationEntry[] = [];

    for (const reminder of claimedReminders) {
        const task = tasksById.get(reminder.parent_task_id);
        const reminderAtMs = new Date(reminder.reminder_at).getTime();
        const isExpired = !Number.isFinite(reminderAtMs) || (nowMs - reminderAtMs) > NOTIFICATION_TTL_MS;
        if (isExpired) {
            continue;
        }
        if (
            reminder.source === DEFAULT_DEADLINE_DUE_REMINDER_SOURCE &&
            dueWarningEnabledByUser.get(reminder.user_id) === false
        ) {
            continue;
        }

        if (task && isReminderTaskActive(task)) {
            notificationEntries.push({
                reminder,
                task,
                eventType: getReminderEventType(reminder.source),
            });
        }
    }

    for (const group of groupReminderNotificationEntries(notificationEntries)) {
        try {
            const sendResult = await sendWithWebRetry(buildReminderNotificationParams(group));

            if (webNeedsRetry(sendResult.push.web)) {
                group.entries.forEach((entry) => remindersToRetry.add(entry.reminder.id));
            }

            await sendRemoteDeliveryMarker(group);

            for (const entry of group.entries) {
                if (entry.reminder.source !== MANUAL_REMINDER_SOURCE && entry.eventType) {
                    await logDefaultReminderEvent(supabase, entry.task, entry.reminder, entry.eventType);
                }
            }
        } catch (error) {
            console.error(`Failed to process task reminder group ${group.key}:`, error);
            group.entries.forEach((entry) => remindersToRetry.add(entry.reminder.id));
        }
    }

    if (remindersToRetry.size > 0) {
        const retryIds = Array.from(remindersToRetry);
        try {
            await rollbackClaimByTimestamp("task_reminders", supabase, retryIds, claimIso);
            console.warn(`Requeued ${retryIds.length} reminder(s) for Web Push retry.`);
        } catch (error) {
            console.error("Failed to requeue reminders for Web Push retry:", error);
        }
    }
}

export const taskReminderNotify = schedules.task({
    id: "task-reminder-notify",
    cron: "* * * * *",
    run: async () => {
        const supabase = createAdminClient();
        const now = new Date();
        await processDueTaskReminders(supabase, now.toISOString());
    },
});
