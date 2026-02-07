/**
 * Trigger: deadline-warning
 * Runs: Every minute (`* * * * *`).
 * What it does when it runs:
 * 1) Finds active tasks (CREATED/POSTPONED) due in about 59-60 minutes and sends a 1-hour reminder.
 * 2) Finds active tasks due in about 1-2 minutes and sends a final reminder.
 * 3) Prevents duplicate reminders by checking existing task_events for DEADLINE_WARNING_1H and DEADLINE_WARNING_2M.
 * 4) Logs reminder events after each notification is sent.
 */
import { schedules } from "@trigger.dev/sdk/v3";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotification } from "@/lib/notifications";
import type { TaskStatus } from "@/lib/xstate/task-machine";

interface DeadlineWarningTask {
    id: string;
    title: string;
    deadline: string;
    status: TaskStatus;
    user: {
        id: string;
    } | null;
}

const ONE_HOUR_REMINDER_EVENT = "DEADLINE_WARNING_1H";
const TWO_MIN_REMINDER_EVENT = "DEADLINE_WARNING_2M";
const ACTIVE_STATUSES: TaskStatus[] = ["CREATED", "POSTPONED"];

function toIso(date: Date): string {
    return date.toISOString();
}

async function loadExistingReminderTaskIds(
    taskIds: string[],
    eventType: string
): Promise<Set<string>> {
    if (taskIds.length === 0) return new Set();

    const supabase = createAdminClient();
    const { data } = await supabase
        .from("task_events")
        .select("task_id")
        .in("task_id", taskIds as any)
        .eq("event_type", eventType as any);

    return new Set(((data as Array<{ task_id: string }> | null) || []).map((row) => row.task_id));
}

async function sendReminderAndLogEvent(
    task: DeadlineWarningTask,
    eventType: string,
    title: string,
    body: string
) {
    const supabase = createAdminClient();

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

export const deadlineWarning = schedules.task({
    id: "deadline-warning",
    cron: "* * * * *",
    run: async () => {
        const supabase = createAdminClient();
        const now = new Date();
        const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
        const fiftyNineMinutesFromNow = new Date(now.getTime() + 59 * 60 * 1000);
        const twoMinutesFromNow = new Date(now.getTime() + 2 * 60 * 1000);
        const oneMinuteFromNow = new Date(now.getTime() + 60 * 1000);

        // Reminder 1: approximately one hour before deadline.
        const oneHourResponse = await supabase
            .from("tasks")
            .select(`
                id,
                title,
                deadline,
                status,
                user:profiles!tasks_user_id_fkey(id)
            `)
            .in("status", ACTIVE_STATUSES as any)
            .gt("deadline", toIso(fiftyNineMinutesFromNow))
            .lte("deadline", toIso(oneHourFromNow));

        if (oneHourResponse.error) {
            console.error("Error fetching tasks for one-hour deadline warnings:", oneHourResponse.error);
        } else {
            const tasks = (oneHourResponse.data || []) as unknown as DeadlineWarningTask[];
            const taskIds = tasks.map((task) => task.id);
            const alreadyWarnedTaskIds = await loadExistingReminderTaskIds(taskIds, ONE_HOUR_REMINDER_EVENT);

            for (const task of tasks) {
                if (!task.user?.id) continue;
                if (alreadyWarnedTaskIds.has(task.id)) continue;

                await sendReminderAndLogEvent(
                    task,
                    ONE_HOUR_REMINDER_EVENT,
                    "Deadline in 1 hour",
                    `1 hour left for ${task.title}`
                );
            }
        }

        // Reminder 2: approximately two minutes before deadline.
        const twoMinuteResponse = await supabase
            .from("tasks")
            .select(`
                id,
                title,
                deadline,
                status,
                user:profiles!tasks_user_id_fkey(id)
            `)
            .in("status", ACTIVE_STATUSES as any)
            .gt("deadline", toIso(oneMinuteFromNow))
            .lte("deadline", toIso(twoMinutesFromNow));

        if (twoMinuteResponse.error) {
            console.error("Error fetching tasks for two-minute deadline warnings:", twoMinuteResponse.error);
            return;
        }

        const twoMinuteTasks = (twoMinuteResponse.data || []) as unknown as DeadlineWarningTask[];
        const twoMinuteTaskIds = twoMinuteTasks.map((task) => task.id);
        const alreadyTwoMinuteWarnedTaskIds = await loadExistingReminderTaskIds(
            twoMinuteTaskIds,
            TWO_MIN_REMINDER_EVENT
        );

        for (const task of twoMinuteTasks) {
            if (!task.user?.id) continue;
            if (alreadyTwoMinuteWarnedTaskIds.has(task.id)) continue;

            await sendReminderAndLogEvent(
                task,
                TWO_MIN_REMINDER_EVENT,
                "Final reminder",
                `final reminder for ${task.title}`
            );
        }
    },
});
