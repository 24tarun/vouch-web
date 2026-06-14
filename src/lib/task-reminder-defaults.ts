import type { Database } from "@/lib/types";

export const MANUAL_REMINDER_SOURCE = "MANUAL" as const;
export const DEFAULT_DEADLINE_1H_REMINDER_SOURCE = "DEFAULT_DEADLINE_1H" as const;
export const DEFAULT_DEADLINE_10M_REMINDER_SOURCE = "DEFAULT_DEADLINE_10M" as const;
export const DEFAULT_DEADLINE_DUE_REMINDER_SOURCE = "DEFAULT_DEADLINE_DUE" as const;

export type TaskReminderSource =
    | typeof MANUAL_REMINDER_SOURCE
    | typeof DEFAULT_DEADLINE_1H_REMINDER_SOURCE
    | typeof DEFAULT_DEADLINE_10M_REMINDER_SOURCE
    | typeof DEFAULT_DEADLINE_DUE_REMINDER_SOURCE;

export type DefaultDeadlineReminderSource =
    | typeof DEFAULT_DEADLINE_1H_REMINDER_SOURCE
    | typeof DEFAULT_DEADLINE_10M_REMINDER_SOURCE
    | typeof DEFAULT_DEADLINE_DUE_REMINDER_SOURCE;

type TaskReminderInsertRow = Database["public"]["Tables"]["task_reminders"]["Insert"];

interface BuildDefaultDeadlineReminderRowsInput {
    parentTaskId: string;
    userId: string;
    deadline: Date;
    deadlineOneHourWarningEnabled: boolean;
    deadlineFinalWarningEnabled: boolean;
    deadlineDueWarningEnabled: boolean;
    now?: Date;
}

export function isDefaultDeadlineReminderSource(
    source: string | null | undefined
): source is DefaultDeadlineReminderSource {
    return (
        source === DEFAULT_DEADLINE_1H_REMINDER_SOURCE ||
        source === DEFAULT_DEADLINE_10M_REMINDER_SOURCE ||
        source === DEFAULT_DEADLINE_DUE_REMINDER_SOURCE
    );
}

export function buildDefaultDeadlineReminderRows({
    parentTaskId,
    userId,
    deadline,
    deadlineOneHourWarningEnabled,
    deadlineFinalWarningEnabled,
    deadlineDueWarningEnabled,
    now = new Date(),
}: BuildDefaultDeadlineReminderRowsInput): TaskReminderInsertRow[] {
    const deadlineMs = deadline.getTime();
    if (Number.isNaN(deadlineMs)) return [];

    const seededNowMs = now.getTime();
    const seededNowIso = now.toISOString();
    const rowsByReminderMs = new Map<number, TaskReminderInsertRow>();

    const pushReminder = (
        enabled: boolean,
        offsetMs: number,
        source: DefaultDeadlineReminderSource
    ) => {
        if (!enabled) return;

        const reminderMs = deadlineMs - offsetMs;
        const reminderIso = new Date(reminderMs).toISOString();
        const isPast = reminderMs <= seededNowMs;

        rowsByReminderMs.set(reminderMs, {
            parent_task_id: parentTaskId,
            user_id: userId,
            reminder_at: reminderIso,
            source,
            notified_at: isPast ? seededNowIso : null,
            created_at: seededNowIso,
            updated_at: seededNowIso,
        });
    };

    pushReminder(
        deadlineOneHourWarningEnabled,
        60 * 60 * 1000,
        DEFAULT_DEADLINE_1H_REMINDER_SOURCE
    );
    pushReminder(
        deadlineFinalWarningEnabled,
        10 * 60 * 1000,
        DEFAULT_DEADLINE_10M_REMINDER_SOURCE
    );
    pushReminder(
        deadlineDueWarningEnabled,
        0,
        DEFAULT_DEADLINE_DUE_REMINDER_SOURCE
    );

    return Array.from(rowsByReminderMs.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, row]) => row);
}
