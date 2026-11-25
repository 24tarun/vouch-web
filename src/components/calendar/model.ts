import { addLocalDays, startOfLocalDay } from "@/lib/calendar/grid";
import { getPinLockReason } from "@/lib/calendar/pins";
import {
    ghostKey,
    isEventTask,
    isOpenTaskStatus,
    type CalendarBlock,
    type CalendarGhost,
    type CalendarTask,
    type CalendarWeekData,
} from "@/lib/calendar/types";
import type { TaskStatus } from "@/lib/xstate/task-machine";

export interface CalendarItem {
    key: string;
    title: string;
    status: TaskStatus | "GHOST";
    deadlineMs: number;
    deadlineIso: string;
    isGhost: boolean;
    isEvent: boolean;
    isStrict: boolean;
    spanStartMs: number | null;
    open: boolean;
    lockReason: string | null;
    canHaveBlocks: boolean;
    task: CalendarTask | null;
    ghost: CalendarGhost | null;
}

export function blockItemKey(block: CalendarBlock): string {
    if (block.task_id) return block.task_id;
    return ghostKey(block.recurrence_rule_id as string, block.occurrence_deadline as string);
}

export function taskToItem(task: CalendarTask, now: Date): CalendarItem {
    const open = isOpenTaskStatus(task.status);
    const isEvent = isEventTask(task);
    const spanStart = task.is_strict ? task.start_at : (task.google_event_start_at ?? task.start_at);
    const spanStartMs = isEvent && spanStart ? Date.parse(spanStart) : NaN;
    return {
        key: task.id,
        title: task.title,
        status: task.status,
        deadlineMs: Date.parse(task.deadline),
        deadlineIso: task.deadline,
        isGhost: false,
        isEvent,
        isStrict: task.is_strict,
        spanStartMs: Number.isFinite(spanStartMs) ? spanStartMs : null,
        open,
        lockReason: getPinLockReason(task, now),
        canHaveBlocks: open && !isEvent && Date.parse(task.deadline) > now.getTime(),
        task,
        ghost: null,
    };
}

export function ghostToItem(ghost: CalendarGhost): CalendarItem {
    const spanStartMs = ghost.spanStartIso ? Date.parse(ghost.spanStartIso) : NaN;
    return {
        key: ghost.key,
        title: ghost.title,
        status: "GHOST",
        deadlineMs: Date.parse(ghost.deadlineIso),
        deadlineIso: ghost.deadlineIso,
        isGhost: true,
        isEvent: ghost.isEvent,
        isStrict: ghost.isStrict,
        spanStartMs: Number.isFinite(spanStartMs) ? spanStartMs : null,
        open: true,
        lockReason: "Not created yet — repeats generate on the day",
        canHaveBlocks: !ghost.isEvent,
        task: null,
        ghost,
    };
}

export interface WeekModel {
    itemsByKey: Map<string, CalendarItem>;
    weekItems: CalendarItem[];
    blocks: CalendarBlock[];
    plannable: CalendarItem[];
}

export function buildWeekModel(data: CalendarWeekData, weekStart: Date, now: Date): WeekModel {
    const weekStartMs = weekStart.getTime();
    const weekEndMs = addLocalDays(weekStart, 7).getTime();
    const itemsByKey = new Map<string, CalendarItem>();
    const hidden = new Set<string>();

    for (const task of [...data.pickerTasks, ...data.tasks]) {
        const item = taskToItem(task, now);
        if (!data.showPastTasks && !item.open) {
            hidden.add(item.key);
            continue;
        }
        itemsByKey.set(item.key, item);
    }
    for (const ghost of data.ghosts) itemsByKey.set(ghost.key, ghostToItem(ghost));

    const weekItems = [...itemsByKey.values()].filter(
        (item) => item.deadlineMs >= weekStartMs && item.deadlineMs < weekEndMs
    );
    const blocks = data.blocks.filter((block) => {
        const key = blockItemKey(block);
        return !hidden.has(key) && itemsByKey.has(key);
    });
    const plannable = [...itemsByKey.values()]
        .filter((item) => item.canHaveBlocks && item.deadlineMs > now.getTime())
        .sort((a, b) => a.deadlineMs - b.deadlineMs || a.title.localeCompare(b.title));

    return { itemsByKey, weekItems, blocks, plannable };
}

export interface DaySegment {
    dayIndex: number;
    startMinutes: number;
    endMinutes: number;
}

export function splitIntoDaySegments(startMs: number, endMs: number, weekStart: Date): DaySegment[] {
    const segments: DaySegment[] = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const dayStart = addLocalDays(startOfLocalDay(weekStart), dayIndex);
        const dayEnd = addLocalDays(dayStart, 1);
        const segStart = Math.max(startMs, dayStart.getTime());
        const segEnd = Math.min(endMs, dayEnd.getTime());
        if (segEnd <= segStart) continue;
        const startDate = new Date(segStart);
        const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
        const endMinutes = segEnd >= dayEnd.getTime()
            ? 24 * 60
            : new Date(segEnd).getHours() * 60 + new Date(segEnd).getMinutes();
        segments.push({ dayIndex, startMinutes, endMinutes: Math.max(endMinutes, startMinutes + 1) });
    }
    return segments;
}
