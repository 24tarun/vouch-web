/**
 * Pure helpers for the calendar week grid. All positioning uses the viewer's
 * local wall clock, matching how the tasks page buckets deadlines.
 */

export const SLOT_MINUTES = 15;
export const SLOT_MS = SLOT_MINUTES * 60 * 1000;
export const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES;
export const DAYS_PER_WEEK = 7;

export function startOfLocalDay(date: Date): Date {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
}

export function addLocalDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

/** Monday 00:00 local of the week containing `date`. */
export function startOfWeekMonday(date: Date): Date {
    const day = startOfLocalDay(date);
    const offsetFromMonday = (day.getDay() + 6) % 7;
    return addLocalDays(day, -offsetFromMonday);
}

export function localDayKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

/** Minutes since local midnight (wall clock, DST-safe for display). */
export function minutesIntoDay(date: Date): number {
    return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

/** Local Date for the start of `slot` (0..SLOTS_PER_DAY) on `day`. */
export function dateAtSlot(day: Date, slot: number): Date {
    const minutes = slot * SLOT_MINUTES;
    const result = startOfLocalDay(day);
    result.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    if (slot >= SLOTS_PER_DAY) {
        return addLocalDays(startOfLocalDay(day), 1);
    }
    return result;
}

export function slotForDate(date: Date): number {
    return Math.floor(minutesIntoDay(date) / SLOT_MINUTES);
}

export function clampSlot(slot: number): number {
    return Math.max(0, Math.min(SLOTS_PER_DAY, Math.round(slot)));
}

export interface DeadlinePinItem {
    id: string;
    deadlineIso: string;
}

export interface DeadlinePinGroup<T extends DeadlinePinItem> {
    key: string;
    dayKey: string;
    slot: number;
    /** Earliest deadline in the group, used for positioning. */
    anchorIso: string;
    items: T[];
}

/** One pin per 15-minute cell per day; items sorted by deadline then id. */
export function groupDeadlinePins<T extends DeadlinePinItem>(items: T[]): DeadlinePinGroup<T>[] {
    const groups = new Map<string, DeadlinePinGroup<T>>();
    for (const item of items) {
        const deadline = new Date(item.deadlineIso);
        if (Number.isNaN(deadline.getTime())) continue;
        const dayKey = localDayKey(deadline);
        const slot = slotForDate(deadline);
        const key = `${dayKey}|${slot}`;
        const existing = groups.get(key);
        if (existing) {
            existing.items.push(item);
        } else {
            groups.set(key, { key, dayKey, slot, anchorIso: item.deadlineIso, items: [item] });
        }
    }
    const result = [...groups.values()];
    for (const group of result) {
        group.items.sort((a, b) => Date.parse(a.deadlineIso) - Date.parse(b.deadlineIso) || a.id.localeCompare(b.id));
        group.anchorIso = group.items[0].deadlineIso;
    }
    return result.sort((a, b) => Date.parse(a.anchorIso) - Date.parse(b.anchorIso));
}

export interface LayoutInput {
    id: string;
    startMs: number;
    endMs: number;
}

export interface LayoutSlot {
    column: number;
    columns: number;
}

/**
 * Side-by-side layout for overlapping intervals: each cluster of transitively
 * overlapping items shares a column count; items take the first free column.
 */
export function layoutOverlaps(items: LayoutInput[]): Map<string, LayoutSlot> {
    const sorted = [...items].sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs || a.id.localeCompare(b.id));
    const result = new Map<string, LayoutSlot>();
    let cluster: Array<{ id: string; column: number }> = [];
    let columnEnds: number[] = [];
    let clusterEnd = -Infinity;

    const flush = () => {
        const columns = Math.max(1, columnEnds.length);
        for (const entry of cluster) result.set(entry.id, { column: entry.column, columns });
        cluster = [];
        columnEnds = [];
    };

    for (const item of sorted) {
        if (item.startMs >= clusterEnd) {
            flush();
            clusterEnd = -Infinity;
        }
        let column = columnEnds.findIndex((end) => end <= item.startMs);
        if (column === -1) {
            column = columnEnds.length;
            columnEnds.push(item.endMs);
        } else {
            columnEnds[column] = item.endMs;
        }
        cluster.push({ id: item.id, column });
        clusterEnd = Math.max(clusterEnd, item.endMs);
    }
    flush();
    return result;
}

export const BLOCK_AFTER_DEADLINE_ERROR = "A block cannot end after the task deadline.";

export function validateBlockRange(startMs: number, endMs: number, deadlineMs: number): string | null {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "Invalid block time.";
    if (startMs % SLOT_MS !== 0 || endMs % SLOT_MS !== 0) return "Blocks must align to 15-minute steps.";
    if (endMs <= startMs) return "A block must be at least 15 minutes.";
    if (endMs - startMs > 24 * 60 * 60 * 1000) return "A block cannot be longer than 24 hours.";
    if (Number.isFinite(deadlineMs) && endMs > deadlineMs) return BLOCK_AFTER_DEADLINE_ERROR;
    return null;
}

/** Latest slot end (exclusive, in slots on `day`) a block may reach before `deadlineMs`. */
export function maxEndSlotBeforeDeadline(day: Date, deadlineMs: number): number {
    const dayStartMs = startOfLocalDay(day).getTime();
    const nextDayMs = addLocalDays(startOfLocalDay(day), 1).getTime();
    if (deadlineMs >= nextDayMs) return SLOTS_PER_DAY;
    if (deadlineMs <= dayStartMs) return 0;
    return Math.floor(minutesIntoDay(new Date(deadlineMs)) / SLOT_MINUTES);
}
