import { fromDateTimeLocalValue } from "@/lib/datetime-local";

export interface ResolvedDateSheetDraft {
    deadline: Date;
    eventStart: Date | null;
    reminders: Date[];
}

export function normalizeReminderDates(values: Date[]): Date[] {
    const deduped = new Map<number, Date>();
    for (const value of values) {
        deduped.set(value.getTime(), value);
    }

    return Array.from(deduped.values()).sort((a, b) => a.getTime() - b.getTime());
}

export function resolveDateSheetDraftSubmission(params: {
    deadlineDraftValue: string;
    eventStartDraftValue?: string;
    reminderDraftValue: string;
    remindersDraft: Date[];
    nowMs?: number;
}): ResolvedDateSheetDraft | { error: string } {
    const {
        deadlineDraftValue,
        eventStartDraftValue = "",
        reminderDraftValue,
        remindersDraft,
        nowMs = Date.now(),
    } = params;

    const parsedDeadline = fromDateTimeLocalValue(deadlineDraftValue);
    if (!parsedDeadline) {
        return { error: "Please choose a valid deadline." };
    }

    if (parsedDeadline.getTime() <= nowMs) {
        return { error: "Deadline must be in the future." };
    }

    const trimmedEventStartDraft = eventStartDraftValue.trim();
    const parsedEventStart =
        trimmedEventStartDraft.length > 0
            ? fromDateTimeLocalValue(eventStartDraftValue)
            : null;

    if (trimmedEventStartDraft.length > 0 && !parsedEventStart) {
        return { error: "Please choose a valid start time." };
    }

    if (parsedEventStart && parsedDeadline.getTime() <= parsedEventStart.getTime()) {
        return { error: "End time must be after start time." };
    }

    const trimmedReminderDraft = reminderDraftValue.trim();
    const pendingReminder =
        trimmedReminderDraft.length > 0
            ? fromDateTimeLocalValue(reminderDraftValue)
            : null;

    if (trimmedReminderDraft.length > 0 && !pendingReminder) {
        return { error: "Please choose a valid reminder." };
    }

    const remindersToApply = normalizeReminderDates(
        pendingReminder ? [...remindersDraft, pendingReminder] : remindersDraft
    );

    const hasInvalidReminder = remindersToApply.some(
        (reminder) => reminder.getTime() <= nowMs || reminder.getTime() > parsedDeadline.getTime()
    );
    if (hasInvalidReminder) {
        return { error: "Reminders must be in the future and before or at the deadline." };
    }

    return {
        deadline: parsedDeadline,
        eventStart: parsedEventStart,
        reminders: remindersToApply,
    };
}
