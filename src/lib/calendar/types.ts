import type { TaskStatus } from "@/lib/xstate/task-machine";

export interface CalendarTask {
    id: string;
    title: string;
    status: TaskStatus;
    deadline: string;
    postponed_at: string | null;
    is_strict: boolean;
    start_at: string | null;
    google_sync_for_task: boolean;
    google_event_start_at: string | null;
    recurrence_rule_id: string | null;
    daily_rule_timezone: string | null;
}

export interface CalendarGhost {
    key: string;
    ruleId: string;
    title: string;
    deadlineIso: string;
    spanStartIso: string | null;
    isEvent: boolean;
    isStrict: boolean;
}

export interface CalendarBlock {
    id: string;
    task_id: string | null;
    recurrence_rule_id: string | null;
    occurrence_deadline: string | null;
    start_at: string;
    end_at: string;
}

export interface CalendarWeekData {
    tasks: CalendarTask[];
    ghosts: CalendarGhost[];
    blocks: CalendarBlock[];
    pickerTasks: CalendarTask[];
    showPastTasks: boolean;
}

export type BlockTarget =
    | { kind: "task"; taskId: string }
    | { kind: "ghost"; ruleId: string; occurrenceDeadlineIso: string };

export function ghostKey(ruleId: string, deadlineIso: string): string {
    return `${ruleId}|${new Date(deadlineIso).toISOString()}`;
}

export function isEventTask(task: Pick<CalendarTask, "google_sync_for_task" | "is_strict">): boolean {
    return task.google_sync_for_task || task.is_strict;
}

export function isOpenTaskStatus(status: string): boolean {
    return status === "ACTIVE" || status === "POSTPONED";
}
