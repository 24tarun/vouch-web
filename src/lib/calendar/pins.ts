import type { CalendarTask } from "@/lib/calendar/types";
import { isEventTask } from "@/lib/calendar/types";

const DEADLINE_GRACE_MS = 60 * 1000;

export function getPinLockReason(
    task: Pick<CalendarTask, "status" | "postponed_at" | "deadline" | "google_sync_for_task" | "is_strict">,
    now: Date = new Date()
): string | null {
    if (task.status !== "ACTIVE") {
        return task.status === "POSTPONED" ? "Already postponed once" : "Task is no longer active";
    }
    if (task.postponed_at) return "Already postponed once";
    if (isEventTask(task)) return task.is_strict ? "Strict tasks are locked" : "Events are locked";
    if (Date.parse(task.deadline) + DEADLINE_GRACE_MS <= now.getTime()) return "Deadline has passed";
    return null;
}

function localDateInTimeZone(ms: number, timeZone: string): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

export function validatePostponeTarget(
    task: Pick<CalendarTask, "deadline" | "daily_rule_timezone">,
    newDeadlineMs: number,
    now: Date = new Date()
): string | null {
    if (!Number.isFinite(newDeadlineMs)) return "Invalid deadline.";
    if (newDeadlineMs <= now.getTime()) return "New deadline must be in the future.";
    if (newDeadlineMs === Date.parse(task.deadline)) return "Deadline unchanged.";
    if (task.daily_rule_timezone) {
        const tz = task.daily_rule_timezone;
        if (localDateInTimeZone(Date.parse(task.deadline), tz) !== localDateInTimeZone(newDeadlineMs, tz)) {
            return "Daily repeating tasks can only be postponed within the same day.";
        }
    }
    return null;
}

export function countBlocksPastDeadline(blocks: Array<{ end_at: string }>, newDeadlineMs: number): number {
    return blocks.filter((block) => Date.parse(block.end_at) > newDeadlineMs).length;
}
