import { DEADLINE_INCLUSIVE_MINUTE_MS } from "@/lib/task-submission-window";

export function getDeadlineMissCutoffIso(now: Date): string {
    return new Date(now.getTime() - DEADLINE_INCLUSIVE_MINUTE_MS).toISOString();
}

export function isDeadlineMissEligible(deadlineIso: string, now: Date): boolean {
    const deadlineTs = Date.parse(deadlineIso);
    if (Number.isNaN(deadlineTs)) return false;
    return deadlineTs <= now.getTime() - DEADLINE_INCLUSIVE_MINUTE_MS;
}
