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
import { sendNotification } from "@/lib/notifications";
import type { TaskStatus } from "@/lib/xstate/task-machine";
import {
    DEFAULT_DEADLINE_1H_REMINDER_SOURCE,
    DEFAULT_DEADLINE_10M_REMINDER_SOURCE,
    MANUAL_REMINDER_SOURCE,
} from "@/lib/task-reminder-defaults";
import { SYSTEM_ACTOR_PROFILE_ID } from "@/lib/system-actor";
import { claimRowsByIdsWithTimestamp, rollbackClaimByTimestamp } from "@/trigger/claim-utils";

interface DueReminder {
    id: string;
    parent_task_id: string;
    user_id: string;
    reminder_at: string;
    source: string;
}

interface ReminderTask {
    id: string;
    title: string;
    status: TaskStatus;
    user_id: string;
}

const ACTIVE_STATUSES: TaskStatus[] = ["ACTIVE", "POSTPONED"];
const ONE_HOUR_REMINDER_EVENT = "DEADLINE_WARNING_1H";
const TEN_MIN_REMINDER_EVENT = "DEADLINE_WARNING_10M";
const NOTIFICATION_TTL_MS = 30 * 60 * 1000;

function getReminderEventType(source: string): string | null {
    if (source === DEFAULT_DEADLINE_1H_REMINDER_SOURCE) return ONE_HOUR_REMINDER_EVENT;
    if (source === DEFAULT_DEADLINE_10M_REMINDER_SOURCE) return TEN_MIN_REMINDER_EVENT;
    return null;
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

    for (const reminder of claimedReminders) {
        const task = tasksById.get(reminder.parent_task_id);
        const reminderAtMs = new Date(reminder.reminder_at).getTime();
        const isExpired = !Number.isFinite(reminderAtMs) || (nowMs - reminderAtMs) > NOTIFICATION_TTL_MS;
        if (isExpired) {
            continue;
        }

        try {
            if (task && ACTIVE_STATUSES.includes(task.status)) {
                const reminderEventType = getReminderEventType(reminder.source);
                if (reminder.source === MANUAL_REMINDER_SOURCE) {
                    const sendResult = await sendWithWebRetry({
                        userId: reminder.user_id,
                        title: "Task reminder",
                        text: `Reminder for "${task.title}".`,
                        email: false,
                        push: true,
                        pushChannels: ["web"],
                        url: `/tasks/${task.id}`,
                        tag: `task-reminder-${reminder.id}`,
                        data: {
                            taskId: task.id,
                            reminderId: reminder.id,
                            kind: "TASK_REMINDER",
                            category: "DEADLINE_REMINDER",
                            reminderAt: reminder.reminder_at,
                        },
                    });
                    if (webNeedsRetry(sendResult.push.web)) {
                        remindersToRetry.add(reminder.id);
                    }
                } else {
                    const isOneHour = reminder.source === DEFAULT_DEADLINE_1H_REMINDER_SOURCE;
                    const title = isOneHour ? "Deadline in 1 hour" : "Deadline in 10 minutes";
                    const text = isOneHour
                        ? `1 hour left for ${task.title}`
                        : `10 minutes left for ${task.title}`;

                    const sendResult = await sendWithWebRetry({
                        userId: reminder.user_id,
                        subject: title,
                        title,
                        text,
                        email: false,
                        push: true,
                        pushChannels: ["web"],
                        url: `/tasks/${task.id}`,
                        tag: `deadline-reminder-${reminder.id}`,
                        data: {
                            taskId: task.id,
                            reminderId: reminder.id,
                            kind: reminderEventType || "DEADLINE_WARNING",
                            category: "DEADLINE_REMINDER",
                            reminderAt: reminder.reminder_at,
                            source: reminder.source,
                        },
                    });

                    if (webNeedsRetry(sendResult.push.web)) {
                        remindersToRetry.add(reminder.id);
                    }
                }

                if (reminder.source !== MANUAL_REMINDER_SOURCE && reminderEventType) {
                    await logDefaultReminderEvent(supabase, task, reminder, reminderEventType);
                }
            }
        } catch (error) {
            console.error(`Failed to process task reminder ${reminder.id}:`, error);
            remindersToRetry.add(reminder.id);
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
