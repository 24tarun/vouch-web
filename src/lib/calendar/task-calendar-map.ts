import type { Task } from "@/lib/types";
import { resolveTaskWindow } from "@/lib/tasks/time-model";

export type CalendarColor = "blue" | "orange" | "purple" | "green" | "red";
export type CalendarSource = "google_or_event" | "app";
export type CalendarEventKind = "timed" | "due";

export interface CalendarEvent {
    id: string;
    title: string;
    start: Date;
    end: Date;
    kind: CalendarEventKind;
    status: Task["status"];
    color: CalendarColor;
    source: CalendarSource;
    isEvent: boolean;
    canDrag: boolean;
}

const ACTIVE_CALENDAR_STATUSES = new Set<Task["status"]>([
    "CREATED",
    "POSTPONED",
    "AWAITING_VOUCHER",
    "MARKED_COMPLETED",
    "COMPLETED",
    "FAILED",
]);

function getStatusColor(status: Task["status"]): CalendarColor {
    if (status === "POSTPONED") return "orange";
    if (status === "AWAITING_VOUCHER" || status === "MARKED_COMPLETED") return "purple";
    if (status === "COMPLETED") return "green";
    if (status === "FAILED") return "red";
    return "blue";
}

export function isCalendarVisibleStatus(status: Task["status"]): boolean {
    return ACTIVE_CALENDAR_STATUSES.has(status);
}

export function mapTaskToCalendarEvent(task: Task): CalendarEvent | null {
    if (!isCalendarVisibleStatus(task.status)) return null;

    const resolved = resolveTaskWindow(task);
    if (!resolved) return null;
    const start = resolved.startAt ?? resolved.endAt;
    const end = resolved.endAt;
    const kind: CalendarEventKind = resolved.isTimed ? "timed" : "due";

    const canDrag =
        task.status === "CREATED" &&
        !task.postponed_at &&
        end.getTime() > Date.now();

    return {
        id: task.id,
        title: task.title,
        start,
        end,
        kind,
        status: task.status,
        color: getStatusColor(task.status),
        source: task.google_sync_for_task ? "google_or_event" : "app",
        isEvent: resolved.isTimed,
        canDrag,
    };
}

export function mapTasksToCalendarEvents(tasks: Task[]): CalendarEvent[] {
    return tasks
        .map(mapTaskToCalendarEvent)
        .filter((event): event is CalendarEvent => Boolean(event))
        .sort((a, b) => a.start.getTime() - b.start.getTime());
}
