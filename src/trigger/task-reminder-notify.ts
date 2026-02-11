/**
 * Trigger: task-reminder-notify
 * Runs: Every minute (`* * * * *`).
 * What it does when it runs:
 * 1) Finds due task reminders that were not notified yet.
 * 2) Sends owner-only reminder notifications (push + email) for active tasks.
 * 3) Sends default 1-hour deadline warnings for active tasks (push only).
 * 4) Sends optional default 5-minute deadline warnings for active tasks (push only).
 * 5) Marks reminders as notified to avoid duplicate sends.
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

interface DeadlineWarningUser {
    id: string;
    deadline_final_warning_enabled?: boolean;
}

interface DeadlineWarningTask {
    id: string;
    title: string;
    deadline: string;
    status: TaskStatus;
    user: DeadlineWarningUser | null;
}

const ACTIVE_STATUSES: TaskStatus[] = ["CREATED", "POSTPONED"];
const ONE_HOUR_REMINDER_EVENT = "DEADLINE_WARNING_1H";
const FIVE_MIN_REMINDER_EVENT = "DEADLINE_WARNING_5M";

function toIso(date: Date): string {
    return date.toISOString();
}

async function loadExistingReminderTaskIds(
    supabase: ReturnType<typeof createAdminClient>,
    taskIds: string[],
    eventType: string
): Promise<Set<string>> {
    if (taskIds.length === 0) return new Set();

    const { data, error } = await supabase
        .from("task_events")
        .select("task_id")
        .in("task_id", taskIds)
        .eq("event_type", eventType);

    if (error) {
        console.error(`Failed to load task_events for ${eventType}:`, error);
        return new Set();
    }

    return new Set(((data as Array<{ task_id: string }> | null) || []).map((row) => row.task_id));
}

async function sendDeadlineWarningAndLogEvent(
    supabase: ReturnType<typeof createAdminClient>,
    task: DeadlineWarningTask,
    eventType: string,
    title: string,
    body: string
) {
    await sendNotification({
        userId: task.user?.id,
        subject: title,
        title,
        text: body,
        email: false,
        push: true,
        url: `/dashboard/tasks/${task.id}`,
        tag: `${eventType.toLowerCase()}-${task.id}`,
        data: {
            taskId: task.id,
            kind: eventType,
            deadline: task.deadline,
        },
    });

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
            deadline: task.deadline,
            body,
        },
    });
}

async function processDueTaskReminders(
    supabase: ReturnType<typeof createAdminClient>,
    nowIso: string
) {
    const dueRemindersResponse = await supabase.from("task_reminders")
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
            const { error: markNotifiedError } = await supabase.from("task_reminders")
                .update({ notified_at: new Date().toISOString() })
                .eq("id", reminder.id);

            if (markNotifiedError) {
                console.error(`Failed to mark reminder ${reminder.id} as notified:`, markNotifiedError);
            }
        }
    }
}

async function processOneHourDeadlineWarnings(
    supabase: ReturnType<typeof createAdminClient>,
    now: Date
) {
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    const fiftyNineMinutesFromNow = new Date(now.getTime() + 59 * 60 * 1000);

    const oneHourResponse = await supabase
        .from("tasks")
        .select(`
            id,
            title,
            deadline,
            status,
            user:profiles!tasks_user_id_fkey(id)
        `)
        .in("status", ACTIVE_STATUSES)
        .gt("deadline", toIso(fiftyNineMinutesFromNow))
        .lte("deadline", toIso(oneHourFromNow));

    if (oneHourResponse.error) {
        console.error("Error fetching tasks for one-hour deadline warnings:", oneHourResponse.error);
        return;
    }

    const tasks = (oneHourResponse.data || []) as unknown as DeadlineWarningTask[];
    const taskIds = tasks.map((task) => task.id);
    const alreadyWarnedTaskIds = await loadExistingReminderTaskIds(
        supabase,
        taskIds,
        ONE_HOUR_REMINDER_EVENT
    );

    for (const task of tasks) {
        if (!task.user?.id) continue;
        if (alreadyWarnedTaskIds.has(task.id)) continue;

        await sendDeadlineWarningAndLogEvent(
            supabase,
            task,
            ONE_HOUR_REMINDER_EVENT,
            "Deadline in 1 hour",
            `1 hour left for ${task.title}`
        );
    }
}

async function processFiveMinuteDeadlineWarnings(
    supabase: ReturnType<typeof createAdminClient>,
    now: Date
) {
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
    const fourMinutesFromNow = new Date(now.getTime() + 4 * 60 * 1000);

    const fiveMinuteResponse = await supabase
        .from("tasks")
        .select(`
            id,
            title,
            deadline,
            status,
            user:profiles!tasks_user_id_fkey(id, deadline_final_warning_enabled)
        `)
        .in("status", ACTIVE_STATUSES)
        .gt("deadline", toIso(fourMinutesFromNow))
        .lte("deadline", toIso(fiveMinutesFromNow));

    if (fiveMinuteResponse.error) {
        console.error("Error fetching tasks for five-minute deadline warnings:", fiveMinuteResponse.error);
        return;
    }

    const tasks = (fiveMinuteResponse.data || []) as unknown as DeadlineWarningTask[];
    const taskIds = tasks.map((task) => task.id);
    const alreadyWarnedTaskIds = await loadExistingReminderTaskIds(
        supabase,
        taskIds,
        FIVE_MIN_REMINDER_EVENT
    );

    for (const task of tasks) {
        if (!task.user?.id) continue;
        if (task.user.deadline_final_warning_enabled !== true) continue;
        if (alreadyWarnedTaskIds.has(task.id)) continue;

        await sendDeadlineWarningAndLogEvent(
            supabase,
            task,
            FIVE_MIN_REMINDER_EVENT,
            "Deadline in 5 minutes",
            `5 minutes left for ${task.title}`
        );
    }
}

export const taskReminderNotify = schedules.task({
    id: "task-reminder-notify",
    cron: "* * * * *",
    run: async () => {
        const supabase = createAdminClient();
        const now = new Date();
        await processDueTaskReminders(supabase, now.toISOString());
        await processOneHourDeadlineWarnings(supabase, now);
        await processFiveMinuteDeadlineWarnings(supabase, now);
    },
});
