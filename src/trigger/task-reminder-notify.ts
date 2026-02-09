/**
 * Trigger: task-reminder-notify
 * Runs: Every minute (`* * * * *`).
 * What it does when it runs:
 * 1) Finds due task reminders that were not notified yet.
 * 2) Sends owner-only reminder notifications (push + email) for active tasks.
 * 3) Marks reminders as notified to avoid duplicate sends.
 */
import { schedules } from "@trigger.dev/sdk/v3";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotification } from "@/lib/notifications";
import type { TaskStatus } from "@/lib/xstate/task-machine";

interface DueReminder {
    id: string;
    parent_task_id: string;
    user_id: string;
    reminder_at: string;
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

const ACTIVE_STATUSES: TaskStatus[] = ["CREATED", "POSTPONED"];

export const taskReminderNotify = schedules.task({
    id: "task-reminder-notify",
    cron: "* * * * *",
    run: async () => {
        const supabase = createAdminClient();
        const nowIso = new Date().toISOString();

        const dueRemindersResponse = await (supabase.from("task_reminders") as any)
            .select("id, parent_task_id, user_id, reminder_at")
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
            (supabase.from("tasks") as any)
                .select("id, title, status, user_id")
                .in("id", taskIds as any),
            (supabase.from("profiles") as any)
                .select("id, email, username")
                .in("id", userIds as any),
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
                        url: `/dashboard/tasks/${task?.id || reminder.parent_task_id}`,
                        tag: `task-reminder-${reminder.id}`,
                        data: {
                            taskId: task?.id || reminder.parent_task_id,
                            reminderId: reminder.id,
                            kind: "TASK_REMINDER",
                            reminderAt: reminder.reminder_at,
                        },
                    });
                }
            } catch (error) {
                console.error(`Failed to send task reminder ${reminder.id}:`, error);
            } finally {
                const { error: markNotifiedError } = await (supabase.from("task_reminders") as any)
                    .update({ notified_at: new Date().toISOString() })
                    .eq("id", reminder.id as any);

                if (markNotifiedError) {
                    console.error(`Failed to mark reminder ${reminder.id} as notified:`, markNotifiedError);
                }
            }
        }
    },
});
