import type { TaskEvent, TaskReminder, TaskWithRelations } from "@/lib/types";
import type { TaskStatus } from "@/lib/xstate/task-machine";

export type RestoredTaskStatus = "ACTIVE" | "POSTPONED";

const TASK_STATUS_VALUE_SET = new Set<TaskStatus>([
    "ACTIVE",
    "POSTPONED",
    "MARKED_COMPLETE",
    "AWAITING_VOUCHER",
    "AWAITING_AI",
    "AI_DENIED",
    "AWAITING_USER",
    "ESCALATED",
    "ACCEPTED",
    "AUTO_ACCEPTED",
    "AI_ACCEPTED",
    "DENIED",
    "MISSED",
    "RECTIFIED",
    "DELETED",
    "SETTLED",
]);

export function isTaskStatus(value: string | null | undefined): value is TaskStatus {
    if (!value) return false;
    return TASK_STATUS_VALUE_SET.has(value as TaskStatus);
}

export function getRestoredStatusFromRevertResult(result: unknown): RestoredTaskStatus | null {
    if (!result || typeof result !== "object" || !("status" in result)) return null;
    const status = (result as { status?: unknown }).status;
    return status === "ACTIVE" || status === "POSTPONED" ? status : null;
}

export function sortTaskReminders(reminders: TaskWithRelations["reminders"] | null | undefined) {
    return (reminders || []).slice().sort((a, b) =>
        new Date(a.reminder_at).getTime() - new Date(b.reminder_at).getTime()
    );
}

export function formatDateDdMmYy(value: Date | string): string {
    return new Date(value).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
    });
}

export function formatTime24h(value: Date | string): string {
    return new Date(value).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
}

export function formatDateTimeDdMmYy(value: Date | string): string {
    return `${formatDateDdMmYy(value)} ${formatTime24h(value)}`;
}

export function formatOrdinal(value: number): string {
    const abs = Math.abs(Math.trunc(value));
    const mod100 = abs % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${abs}th`;
    const mod10 = abs % 10;
    if (mod10 === 1) return `${abs}st`;
    if (mod10 === 2) return `${abs}nd`;
    if (mod10 === 3) return `${abs}rd`;
    return `${abs}th`;
}

export function toReminderIso(value: string): string | null {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
}

export function normalizeReminderIsos(values: string[]): string[] {
    const deduped = new Map<number, string>();
    for (const value of values) {
        const normalizedIso = toReminderIso(value);
        if (!normalizedIso) continue;
        deduped.set(new Date(normalizedIso).getTime(), normalizedIso);
    }
    return Array.from(deduped.values()).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
}

export function splitRemindersByTime<T extends { reminder_at: string }>(reminders: T[], referenceNowMs: number) {
    const pastReminders: T[] = [];
    const futureReminders: T[] = [];

    for (const reminder of reminders) {
        const reminderMs = new Date(reminder.reminder_at).getTime();
        if (Number.isNaN(reminderMs)) continue;
        if (reminderMs <= referenceNowMs) {
            pastReminders.push(reminder);
        } else {
            futureReminders.push(reminder);
        }
    }

    const sortByReminderAt = (a: { reminder_at: string }, b: { reminder_at: string }) =>
        new Date(a.reminder_at).getTime() - new Date(b.reminder_at).getTime();

    return {
        pastReminders: pastReminders.slice().sort(sortByReminderAt),
        futureReminders: futureReminders.slice().sort(sortByReminderAt),
    };
}

export function mergeDueReminderTimelineEvents(
    events: TaskEvent[],
    reminders: TaskReminder[],
    referenceNowMs: number
): TaskEvent[] {
    const hasFinalCallEvent = events.some((event) => event.event_type === "DEADLINE_WARNING_DUE");
    if (hasFinalCallEvent) return events;

    const dueReminder = reminders.find((reminder) => {
        if (reminder.source !== "DEFAULT_DEADLINE_DUE") return false;
        const reminderMs = new Date(reminder.reminder_at).getTime();
        return Number.isFinite(reminderMs) && reminderMs <= referenceNowMs;
    });
    if (!dueReminder) return events;

    const syntheticFinalCallEvent: TaskEvent = {
        id: `reminder:${dueReminder.id}:deadline-warning-due`,
        task_id: dueReminder.parent_task_id,
        event_type: "DEADLINE_WARNING_DUE",
        actor_id: null,
        from_status: "ACTIVE",
        to_status: "ACTIVE",
        metadata: {
            reminder_id: dueReminder.id,
            reminder_at: dueReminder.reminder_at,
            source: dueReminder.source,
            synthetic_from_reminder: true,
        },
        created_at: dueReminder.reminder_at,
    };

    return [...events, syntheticFinalCallEvent].sort((a, b) => {
        const aMs = new Date(a.created_at).getTime();
        const bMs = new Date(b.created_at).getTime();
        if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return 0;
        return aMs - bMs;
    });
}

export function formatFocusTime(seconds: number): string {
    if (!seconds || seconds <= 0) return "0m";
    if (seconds < 60) return `${seconds}s`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

export function getPomoElapsedSeconds(event: TaskEvent): number {
    const elapsedRaw = event.metadata?.elapsed_seconds;
    return typeof elapsedRaw === "number" ? elapsedRaw : Number(elapsedRaw ?? 0);
}

export function formatDateDdMmYyyy(value: Date | string): string {
    return new Date(value).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    });
}

export function formatDateTimeDdMmYyyy24h(value: Date | string): string {
    return `${formatDateDdMmYyyy(value)} ${formatTime24h(value)}`;
}

export function formatEventTimestamp(event: TaskEvent): string {
    if (event.event_type !== "POMO_COMPLETED") {
        return formatDateTimeDdMmYyyy24h(event.created_at);
    }

    const elapsedSeconds = getPomoElapsedSeconds(event);
    const endDate = new Date(event.created_at);
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0 || Number.isNaN(endDate.getTime())) {
        return formatDateTimeDdMmYyyy24h(event.created_at);
    }

    const startDate = new Date(endDate.getTime() - elapsedSeconds * 1000);
    return `${formatDateTimeDdMmYyyy24h(startDate)} -> ${formatDateTimeDdMmYyyy24h(endDate)}`;
}

export type ActivityTone =
    | "success"
    | "danger"
    | "warning"
    | "info"
    | "proof"
    | "statusBlue"
    | "statusOrange"
    | "statusPurple"
    | "statusSlate"
    | "neutral";

export function getActivityStepTone(event: TaskEvent): ActivityTone {
    // Event-specific tones must win over status transitions.
    if (event.event_type === "DEADLINE_WARNING_1H" || event.event_type === "DEADLINE_WARNING_10M" || event.event_type === "DEADLINE_WARNING_DUE" || event.event_type === "VOUCHER_TIMEOUT" || event.event_type === "POSTPONE") return "warning";
    if (["PROOF_UPLOAD_FAILED_REVERT", "PROOF_REQUESTED", "PROOF_UPLOADED", "PROOF_REMOVED"].includes(event.event_type)) return "proof";
    if (event.event_type === "POMO_COMPLETED") return "info";
    if (["ACTIVE", "CREATED", "UNDO_COMPLETE", "ESCALATE", "AI_ESCALATE_TO_HUMAN"].includes(event.event_type)) return "statusBlue";
    if (["REPETITION_STOPPED", "REPETITION_PAUSED", "REPETITION_RESUMED"].includes(event.event_type)) return "statusPurple";
    if (["RECTIFY", "AI_DENIED_AUTO_HOP"].includes(event.event_type)) return "statusOrange";
    if (["VOUCHER_DELETE"].includes(event.event_type)) return "statusSlate";
    if (["VOUCHER_ACCEPT", "AI_APPROVE", "MARK_COMPLETE"].includes(event.event_type)) return "success";
    if (["VOUCHER_DENY", "AI_DENY", "ACCEPT_DENIAL", "DEADLINE_MISSED", "GOOGLE_EVENT_CANCELLED"].includes(event.event_type)) return "danger";

    const toStatus = event.to_status;
    if (["MARKED_COMPLETE", "ACCEPTED", "AUTO_ACCEPTED", "AI_ACCEPTED"].includes(toStatus)) return "success";
    if (["DENIED", "AI_DENIED", "MISSED"].includes(toStatus)) return "danger";
    if (["AWAITING_VOUCHER", "AWAITING_AI"].includes(toStatus)) return "warning";
    if (["ACTIVE", "POSTPONED", "ESCALATED"].includes(toStatus)) return "statusBlue";
    if (["AWAITING_USER", "RECTIFIED"].includes(toStatus)) return "statusOrange";
    if (toStatus === "SETTLED") return "statusPurple";
    if (toStatus === "DELETED") return "statusSlate";

    return "neutral";
}

export function buildVisibleEvents(events: TaskEvent[]): TaskEvent[] {
    const seenSessionIds = new Set<string>();
    const filtered = events.filter((event) => {
        if (event.event_type !== "POMO_COMPLETED") return true;
        const sessionIdRaw = event.metadata?.session_id;
        const sessionId = typeof sessionIdRaw === "string" ? sessionIdRaw : "";
        if (!sessionId) return true;
        if (seenSessionIds.has(sessionId)) return false;
        seenSessionIds.add(sessionId);
        return true;
    });

    const minuteBucket = (iso: string) => {
        const ms = new Date(iso).getTime();
        return Number.isNaN(ms) ? Number.NaN : Math.floor(ms / 60000);
    };

    const isAwaitingTransition = (event: TaskEvent) =>
        event.from_status !== event.to_status &&
        typeof event.to_status === "string" &&
        event.to_status.startsWith("AWAITING_");

    return [...filtered].sort((a, b) => {
        const aMinute = minuteBucket(a.created_at);
        const bMinute = minuteBucket(b.created_at);

        if (Number.isNaN(aMinute) || Number.isNaN(bMinute) || aMinute !== bMinute) return 0;

        const aIsProofUploaded = a.event_type === "PROOF_UPLOADED";
        const bIsProofUploaded = b.event_type === "PROOF_UPLOADED";
        const aIsAwaiting = isAwaitingTransition(a);
        const bIsAwaiting = isAwaitingTransition(b);

        if (aIsProofUploaded && bIsAwaiting) return -1;
        if (bIsProofUploaded && aIsAwaiting) return 1;
        return 0;
    });
}
