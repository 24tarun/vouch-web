export const TASK_SUBMISSION_BEFORE_START_ERROR = "Task cannot be submitted before its start time.";
export const DEADLINE_INCLUSIVE_MINUTE_MS = 60 * 1000;

export interface TaskSubmissionWindowState {
    startDate: Date | null;
    deadlineDate: Date | null;
    beforeStart: boolean;
    pastDeadline: boolean;
    canSubmitNow: boolean;
    completionBlocked: boolean;
}

interface TaskSubmissionWindowInput {
    startAtIso?: string | null;
    deadlineIso?: string | null;
    isStrict?: boolean;
    now?: Date;
}

function parseIsoDate(value?: string | null): Date | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    if (!normalized) return null;
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
}

export function isWithinInclusiveDeadlineMinute(deadlineDate: Date, now: Date): boolean {
    return now.getTime() < deadlineDate.getTime() + DEADLINE_INCLUSIVE_MINUTE_MS;
}

export function getTaskSubmissionWindowState(input: TaskSubmissionWindowInput): TaskSubmissionWindowState {
    const now = input.now instanceof Date && !Number.isNaN(input.now.getTime())
        ? input.now
        : new Date();
    const startDate = parseIsoDate(input.startAtIso);
    const deadlineDate = parseIsoDate(input.deadlineIso);
    const beforeStart = Boolean(input.isStrict) && Boolean(startDate) && now.getTime() < (startDate as Date).getTime();
    const pastDeadline = Boolean(deadlineDate) && !isWithinInclusiveDeadlineMinute(deadlineDate as Date, now);
    const canSubmitNow = !beforeStart && !pastDeadline;

    return {
        startDate,
        deadlineDate,
        beforeStart,
        pastDeadline,
        canSubmitNow,
        completionBlocked: !canSubmitNow,
    };
}

export function buildBeforeStartSubmissionMessage(startDate: Date | null): string {
    if (!startDate || Number.isNaN(startDate.getTime())) {
        return TASK_SUBMISSION_BEFORE_START_ERROR;
    }

    const formattedStart = startDate.toLocaleString(undefined, {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });

    return `${TASK_SUBMISSION_BEFORE_START_ERROR} Available after ${formattedStart}.`;
}
