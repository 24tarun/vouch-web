/**
 * Trigger: task-reminder-notify
 * Runs: Every minute (`* * * * *`).
 * What it does when it runs:
 * 1) Finds due task reminders that were not notified yet.
 * 2) Sends owner notifications for active tasks.
 *    - MANUAL reminders: push + email
 *    - DEFAULT_DEADLINE_1H / DEFAULT_DEADLINE_5M reminders: push only
 * 3) Writes deadline warning task events for seeded default reminders.
 * 4) Marks reminders as notified to avoid duplicate sends.
 */
import { schedules } from "@trigger.dev/sdk/v3";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotification } from "@/lib/notifications";
import type { TaskStatus } from "@/lib/xstate/task-machine";
import {
    DEFAULT_DEADLINE_1H_REMINDER_SOURCE,
    DEFAULT_DEADLINE_5M_REMINDER_SOURCE,
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

interface SupabaseUpdateError {
    message?: string;
}

const ACTIVE_STATUSES: TaskStatus[] = ["CREATED", "POSTPONED"];
const ONE_HOUR_REMINDER_EVENT = "DEADLINE_WARNING_1H";
const FIVE_MIN_REMINDER_EVENT = "DEADLINE_WARNING_5M";

function getReminderEventType(source: string): string | null {
    if (source === DEFAULT_DEADLINE_1H_REMINDER_SOURCE) return ONE_HOUR_REMINDER_EVENT;
    if (source === DEFAULT_DEADLINE_5M_REMINDER_SOURCE) return FIVE_MIN_REMINDER_EVENT;
    return null;
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

    const taskIds = Array.from(new Set(dueReminders.map((reminder) => reminder.parent_task_id)));
    const userIds = Array.from(new Set(dueReminders.map((reminder) => reminder.user_id)));

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

    for (const reminder of dueReminders) {
        const task = tasksById.get(reminder.parent_task_id);
        const owner = usersById.get(reminder.user_id);

        try {
            if (task && ACTIVE_STATUSES.includes(task.status)) {
                const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
                const reminderEventType = getReminderEventType(reminder.source);

                if (reminder.source === MANUAL_REMINDER_SOURCE) {
                    await sendNotification({
                        to: owner?.email,
                        userId: reminder.user_id,
                        subject: `Task reminder: ${task.title}`,
                        title: "Task reminder",
                        text: `Reminder for "${task.title}".`,
                        html: `
                            <h1>Task reminder</h1>
                            <p>Hi ${owner?.username || "there"},</p>
                            <p>This is your reminder for <strong>${task.title}</strong>.</p>
                            <p><a href="${appUrl}/dashboard/tasks/${task.id}">Open task details</a></p>
                        `,
                        url: `/dashboard/tasks/${task.id}`,
                        tag: `task-reminder-${reminder.id}`,
                        data: {
                            taskId: task.id,
                            reminderId: reminder.id,
                            kind: "TASK_REMINDER",
                            reminderAt: reminder.reminder_at,
                        },
                    });
                } else {
                    const isOneHour = reminder.source === DEFAULT_DEADLINE_1H_REMINDER_SOURCE;
                    const title = isOneHour ? "Deadline in 1 hour" : "Deadline in 5 minutes";
                    const text = isOneHour
                        ? `1 hour left for ${task.title}`
                        : `5 minutes left for ${task.title}`;

                    await sendNotification({
                        userId: reminder.user_id,
                        subject: title,
                        title,
                        text,
                        email: false,
                        push: true,
                        url: `/dashboard/tasks/${task.id}`,
                        tag: `deadline-reminder-${reminder.id}`,
                        data: {
                            taskId: task.id,
                            reminderId: reminder.id,
                            kind: reminderEventType || "DEADLINE_WARNING",
                            reminderAt: reminder.reminder_at,
                            source: reminder.source,
                        },
                    });

                    if (reminderEventType) {
                        await logDefaultReminderEvent(supabase, task, reminder, reminderEventType);
                    }
                }
            }
        } catch (error) {
            console.error(`Failed to send task reminder ${reminder.id}:`, error);
        } finally {
            const taskReminders = supabase.from("task_reminders") as unknown as {
                update: (values: { notified_at: string }) => {
                    eq: (column: "id", value: string) => Promise<{ error: SupabaseUpdateError | null }>;
                };
            };
            const { error: markNotifiedError } = await taskReminders
                .update({ notified_at: new Date().toISOString() })
                .eq("id", reminder.id);

            if (markNotifiedError) {
                console.error(`Failed to mark reminder ${reminder.id} as notified:`, markNotifiedError);
            }
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
