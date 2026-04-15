/**
 * Trigger: task-reminder-notify
 * Runs: Every minute (`* * * * *`).
 * What it does when it runs:
 * 1) Finds due task reminders that were not notified yet.
 * 2) Sends owner notifications for active tasks.
 *    - MANUAL reminders: push + email
 *    - DEFAULT_DEADLINE_1H / DEFAULT_DEADLINE_10M reminders: push only
 * 3) Writes deadline warning task events for seeded default reminders.
 * 4) Marks reminders as notified to avoid duplicate sends.
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

interface ReminderUser {
    id: string;
    email: string;
    username: string | null;
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

function expoNeedsRetry(expoResult: {
    total: number;
    delivered: number;
    failed: number;
    skipped?: boolean;
} | null | undefined): boolean {
    if (!expoResult) return true;
    if (expoResult.skipped) return false;
    if (expoResult.total <= 0) return false;
    return expoResult.delivered < expoResult.total || expoResult.failed > 0;
}

async function sendWithExpoRetry(params: Parameters<typeof sendNotification>[0]) {
    let result = await sendNotification(params);

    if (!expoNeedsRetry(result.push.expo)) {
        return result;
    }

    // Best-effort immediate retries for Expo channel only.
    for (let attempt = 0; attempt < 2; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        result = await sendNotification({
            ...params,
            pushChannels: ["expo"],
        });

        if (!expoNeedsRetry(result.push.expo)) {
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
            actor_id: string | null;
            from_status: TaskStatus;
            to_status: TaskStatus;
            metadata: Record<string, unknown>;
        }) => Promise<unknown>;
    };

    await taskEvents.insert({
        task_id: task.id,
        event_type: eventType,
        actor_id: null,
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
    const taskReminders = supabase.from("task_reminders") as any;
    const claimResponse = await taskReminders
        .update({ notified_at: claimIso } as any)
        .in("id", dueReminderIds as any)
        .is("notified_at", null)
        .select("id, parent_task_id, user_id, reminder_at, source");

    if (claimResponse.error) {
        console.error("Failed to claim due task reminders:", claimResponse.error);
        return;
    }

    const claimedReminders = ((claimResponse.data as DueReminder[] | null) || []);
    if (claimedReminders.length === 0) {
        return;
    }

    const taskIds = Array.from(new Set(claimedReminders.map((reminder) => reminder.parent_task_id)));
    const userIds = Array.from(new Set(claimedReminders.map((reminder) => reminder.user_id)));

    const [tasksResponse, usersResponse] = await Promise.all([
        supabase.from("tasks")
            .select("id, title, status, user_id")
            .in("id", taskIds),
        supabase.from("profiles")
            .select("id, email, username")
            .in("id", userIds),
    ]);

    if (tasksResponse.error) {
        console.error("Failed to load tasks for due reminders:", tasksResponse.error);
        return;
    }

    if (usersResponse.error) {
        console.error("Failed to load users for due reminders:", usersResponse.error);
        return;
    }

    const tasksById = new Map<string, ReminderTask>();
    for (const task of ((tasksResponse.data as ReminderTask[] | null) || [])) {
        tasksById.set(task.id, task);
    }

    const usersById = new Map<string, ReminderUser>();
    for (const user of ((usersResponse.data as ReminderUser[] | null) || [])) {
        usersById.set(user.id, user);
    }

    const remindersToRetry = new Set<string>();
    const nowMs = Date.now();

    for (const reminder of claimedReminders) {
        const task = tasksById.get(reminder.parent_task_id);
        const owner = usersById.get(reminder.user_id);
        const reminderAtMs = new Date(reminder.reminder_at).getTime();
        const isExpired = !Number.isFinite(reminderAtMs) || (nowMs - reminderAtMs) > NOTIFICATION_TTL_MS;
        if (isExpired) {
            continue;
        }

        try {
            if (task && ACTIVE_STATUSES.includes(task.status)) {
                const reminderEventType = getReminderEventType(reminder.source);

                if (reminder.source === MANUAL_REMINDER_SOURCE) {
                    const sendResult = await sendWithExpoRetry({
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
                            kind: "TASK_REMINDER",
                            reminderAt: reminder.reminder_at,
                        },
                    });

                    if (expoNeedsRetry(sendResult.push.expo)) {
                        remindersToRetry.add(reminder.id);
                    }
                } else {
                    const isOneHour = reminder.source === DEFAULT_DEADLINE_1H_REMINDER_SOURCE;
                    const title = isOneHour ? "Deadline in 1 hour" : "Deadline in 10 minutes";
                    const text = isOneHour
                        ? `1 hour left for ${task.title}`
                        : `10 minutes left for ${task.title}`;

                    const sendResult = await sendWithExpoRetry({
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
                            kind: reminderEventType || "DEADLINE_WARNING",
                            reminderAt: reminder.reminder_at,
                            source: reminder.source,
                        },
                    });

                    if (expoNeedsRetry(sendResult.push.expo)) {
                        remindersToRetry.add(reminder.id);
                    }

                    if (reminderEventType) {
                        await logDefaultReminderEvent(supabase, task, reminder, reminderEventType);
                    }
                }
            }
        } catch (error) {
            console.error(`Failed to send task reminder ${reminder.id}:`, error);
            remindersToRetry.add(reminder.id);
        }
    }

    if (remindersToRetry.size > 0) {
        const retryIds = Array.from(remindersToRetry);
        const revertResponse = await (supabase.from("task_reminders") as any)
            .update({ notified_at: null } as any)
            .in("id", retryIds as any)
            .eq("notified_at", claimIso as any);

        if (revertResponse.error) {
            console.error("Failed to requeue reminders for Expo retry:", revertResponse.error);
        } else {
            console.warn(`Requeued ${retryIds.length} reminder(s) for Expo retry.`);
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
