export interface CreateTaskPayload {
    title: string;
    rawTitle: string;
    isEventTask: boolean;
    subtasks: string[];
    requiredPomoMinutes: number | null;
    startIso: string | null;
    deadlineIso: string;
    eventEndIso: string | null;
    reminderIsos: string[];
    voucherId: string;
    failureCost: string;
    recurrenceType: string | null;
    recurrenceDays: number[];
    userTimezone: string;
}

export function buildCreateTaskFormData(payload: CreateTaskPayload): FormData {
    const formData = new FormData();
    formData.append("title", payload.rawTitle);
    if (payload.startIso) {
        formData.append("startIso", payload.startIso);
    }
    formData.append("deadline", payload.deadlineIso);
    if (payload.eventEndIso) {
        formData.append("eventEndIso", payload.eventEndIso);
    }
    formData.append("voucherId", payload.voucherId);
    formData.append("failureCost", payload.failureCost);
    if (payload.subtasks.length > 0) {
        formData.append("subtasks", JSON.stringify(payload.subtasks));
    }
    if (payload.requiredPomoMinutes != null) {
        formData.append("requiredPomoMinutes", String(payload.requiredPomoMinutes));
    }
    if (payload.reminderIsos.length > 0) {
        formData.append("reminders", JSON.stringify(payload.reminderIsos));
    }

    if (payload.recurrenceType) {
        formData.append("recurrenceType", payload.recurrenceType);
        formData.append("userTimezone", payload.userTimezone);
        formData.append("recurrenceInterval", "1");

        if (payload.recurrenceType === "WEEKLY" && payload.recurrenceDays.length > 0) {
            formData.append("recurrenceDays", JSON.stringify(payload.recurrenceDays));
        }
    }

    return formData;
}
