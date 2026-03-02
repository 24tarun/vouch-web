"use client";

import type { CSSProperties, DragEvent, MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CalendarColor, CalendarEvent } from "@/lib/calendar/task-calendar-map";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

export type CalendarView = "month" | "week" | "day" | "list";

interface TaskCalendarProps {
    events: CalendarEvent[];
    onCreateFromSlot?: (slotDate: Date, view: CalendarView) => void;
    onReschedule?: (taskId: string, nextStartAt: Date) => Promise<void> | void;
    onOpenTask?: (taskId: string) => void;
    defaultView?: CalendarView;
    className?: string;
}

interface PositionedTimedEvent {
    event: CalendarEvent;
    startMinutes: number;
    endMinutes: number;
    top: number;
    height: number;
    column: number;
    columns: number;
}

interface PositionedDueLineEvent {
    event: CalendarEvent;
    top: number;
    column: number;
    columns: number;
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, index) => index);

const MINUTES_PER_DAY = 24 * 60;
const SNAP_MINUTES = 30;
const PX_PER_MINUTE = 0.795; // 25% denser than previous 1.06 scale
const HOUR_HEIGHT = 60 * PX_PER_MINUTE;
const TIMELINE_HEIGHT = MINUTES_PER_DAY * PX_PER_MINUTE;
const CALENDAR_VIEW_STORAGE_KEY = "task-calendar:view";
const DUE_MARKER_HEIGHT = 30;
const DUE_COLLISION_MINUTES = Math.max(15, Math.ceil(DUE_MARKER_HEIGHT / PX_PER_MINUTE));
const MONTH_MAX_VISIBLE_EVENTS = 2;

const COLOR_META: Record<CalendarColor, { timed: string; due: string }> = {
    blue: {
        timed: "border-cyan-300/20 bg-cyan-400/22 text-cyan-50",
        due: "border-cyan-300/25 bg-cyan-500/15 text-cyan-100",
    },
    orange: {
        timed: "border-amber-300/20 bg-amber-400/20 text-amber-50",
        due: "border-amber-300/25 bg-amber-500/16 text-amber-100",
    },
    purple: {
        timed: "border-fuchsia-300/20 bg-fuchsia-400/20 text-fuchsia-50",
        due: "border-fuchsia-300/25 bg-fuchsia-500/16 text-fuchsia-100",
    },
    green: {
        timed: "border-emerald-300/20 bg-emerald-400/20 text-emerald-50",
        due: "border-emerald-300/25 bg-emerald-500/16 text-emerald-100",
    },
    red: {
        timed: "border-rose-300/20 bg-rose-400/20 text-rose-50",
        due: "border-rose-300/25 bg-rose-500/16 text-rose-100",
    },
};

const SOLID_COLOR_META: Record<CalendarColor, { timed: string; due: string }> = {
    blue: {
        timed: "border-cyan-200/70 bg-cyan-400 text-slate-950",
        due: "border-cyan-200/70 bg-cyan-400 text-slate-950",
    },
    orange: {
        timed: "border-amber-200/70 bg-amber-400 text-slate-950",
        due: "border-amber-200/70 bg-amber-400 text-slate-950",
    },
    purple: {
        timed: "border-fuchsia-200/70 bg-fuchsia-500 text-fuchsia-50",
        due: "border-fuchsia-200/70 bg-fuchsia-500 text-fuchsia-50",
    },
    green: {
        timed: "border-emerald-200/70 bg-emerald-500 text-emerald-50",
        due: "border-emerald-200/70 bg-emerald-500 text-emerald-50",
    },
    red: {
        timed: "border-rose-200/70 bg-rose-500 text-rose-50",
        due: "border-rose-200/70 bg-rose-500 text-rose-50",
    },
};

const SOLID_BLOCK_STATUSES = new Set<CalendarEvent["status"]>(["CREATED", "POSTPONED"]);
const MONTH_DOT_META: Record<CalendarColor, string> = {
    blue: "bg-cyan-300",
    orange: "bg-amber-300",
    purple: "bg-fuchsia-300",
    green: "bg-emerald-300",
    red: "bg-rose-300",
};

function isCalendarView(value: string): value is CalendarView {
    return value === "month" || value === "week" || value === "day" || value === "list";
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function startOfDay(date: Date): Date {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    return next;
}

function isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function getWeekStartMonday(date: Date): Date {
    const next = startOfDay(date);
    const mondayOffset = (next.getDay() + 6) % 7;
    next.setDate(next.getDate() - mondayOffset);
    return next;
}

function formatHour(hour: number): string {
    return `${String(hour).padStart(2, "0")}:00`;
}

function formatTime(date: Date): string {
    return date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
}

function statusLabel(status: string): string {
    return status.replace(/_/g, " ");
}

function getEventSurfaceClasses(event: CalendarEvent): string {
    const palette = SOLID_BLOCK_STATUSES.has(event.status) ? SOLID_COLOR_META : COLOR_META;
    return event.kind === "due" ? palette[event.color].due : palette[event.color].timed;
}

function getStrikeOverlayStyle(status: CalendarEvent["status"]): CSSProperties | null {
    let stripeColor: string | null = null;
    if (status === "MARKED_COMPLETED" || status === "AWAITING_VOUCHER") {
        stripeColor = "rgba(232, 121, 249, 0.4)";
    } else if (status === "COMPLETED") {
        stripeColor = "rgba(52, 211, 153, 0.4)";
    } else if (status === "FAILED") {
        stripeColor = "rgba(251, 113, 133, 0.4)";
    }

    if (!stripeColor) return null;
    return {
        backgroundImage: `repeating-linear-gradient(115deg, transparent 0 10px, ${stripeColor} 10px 12px, transparent 12px 20px)`,
    };
}

function getEventDay(event: CalendarEvent): Date {
    return event.kind === "due" ? startOfDay(event.end) : startOfDay(event.start);
}

function getRangeTitle(view: CalendarView, currentDate: Date): string {
    if (view === "month") {
        return currentDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }

    if (view === "week") {
        const monday = getWeekStartMonday(currentDate);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);

        const sameMonth = monday.getMonth() === sunday.getMonth() && monday.getFullYear() === sunday.getFullYear();
        if (sameMonth) {
            const month = monday.toLocaleDateString(undefined, { month: "short" });
            return `${month} ${monday.getDate()} - ${sunday.getDate()}, ${sunday.getFullYear()}`;
        }

        return `${monday.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
        })} - ${sunday.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
        })}`;
    }

    if (view === "day") {
        return currentDate.toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
        });
    }

    return "Task Agenda";
}

function toMinutes(date: Date): number {
    return date.getHours() * 60 + date.getMinutes();
}

function isPastDay(date: Date): boolean {
    return startOfDay(date).getTime() < startOfDay(new Date()).getTime();
}

function isPastSlot(date: Date): boolean {
    return date.getTime() < Date.now();
}

function snapMinutes(value: number): number {
    return clamp(Math.round(value / SNAP_MINUTES) * SNAP_MINUTES, 0, MINUTES_PER_DAY - SNAP_MINUTES);
}

function dateAtMinutes(day: Date, minutes: number): Date {
    const next = startOfDay(day);
    next.setMinutes(minutes, 0, 0);
    return next;
}

function getDefaultDropMinutes(event: CalendarEvent): number {
    return event.kind === "timed" ? toMinutes(event.start) : toMinutes(event.end);
}

function getEventSortTime(event: CalendarEvent): number {
    return event.kind === "due" ? event.end.getTime() : event.start.getTime();
}

function getCurrentTimeTop(date: Date): number {
    const minuteOfDay = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
    return clamp(minuteOfDay * PX_PER_MINUTE, 0, TIMELINE_HEIGHT);
}

interface TimelineLayoutItem {
    event: CalendarEvent;
    kind: "timed" | "due";
    startMinutes: number;
    endMinutes: number;
    top: number;
    height: number;
    column: number;
    columns: number;
}

function buildTimelineLayout(events: CalendarEvent[]): { timed: PositionedTimedEvent[]; due: PositionedDueLineEvent[] } {
    const items: TimelineLayoutItem[] = events
        .filter((event) => event.kind === "timed" || event.kind === "due")
        .map((event): TimelineLayoutItem => {
            if (event.kind === "timed") {
                const startMinutes = clamp(toMinutes(event.start), 0, MINUTES_PER_DAY - 1);
                const rawEndMinutes = clamp(toMinutes(event.end), startMinutes + 1, MINUTES_PER_DAY);
                const endMinutes = Math.max(startMinutes + 15, rawEndMinutes);
                return {
                    event,
                    kind: "timed",
                    startMinutes,
                    endMinutes,
                    top: startMinutes * PX_PER_MINUTE,
                    height: (endMinutes - startMinutes) * PX_PER_MINUTE,
                    column: 0,
                    columns: 1,
                };
            }

            const dueMinute = clamp(toMinutes(event.end), 0, MINUTES_PER_DAY - 1);
            const startMinutes = dueMinute;
            const endMinutes = clamp(dueMinute + DUE_COLLISION_MINUTES, dueMinute + 1, MINUTES_PER_DAY);
            const top = clamp(
                dueMinute * PX_PER_MINUTE - DUE_MARKER_HEIGHT / 2,
                0,
                TIMELINE_HEIGHT - DUE_MARKER_HEIGHT
            );
            return {
                event,
                kind: "due",
                startMinutes,
                endMinutes,
                top,
                height: DUE_MARKER_HEIGHT,
                column: 0,
                columns: 1,
            };
        })
        .sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);

    if (items.length === 0) {
        return { timed: [], due: [] };
    }

    const positioned: TimelineLayoutItem[] = [];
    let cluster: TimelineLayoutItem[] = [];
    let clusterEnd = -1;

    const flushCluster = () => {
        if (cluster.length === 0) return;

        const active: TimelineLayoutItem[] = [];
        let maxColumns = 1;

        for (const item of cluster) {
            for (let index = active.length - 1; index >= 0; index -= 1) {
                if (active[index].endMinutes <= item.startMinutes) {
                    active.splice(index, 1);
                }
            }

            const occupied = new Set(active.map((activeItem) => activeItem.column));
            let column = 0;
            while (occupied.has(column)) {
                column += 1;
            }

            item.column = column;
            active.push(item);
            maxColumns = Math.max(maxColumns, active.length);
        }

        for (const item of cluster) {
            item.columns = maxColumns;
            positioned.push(item);
        }

        cluster = [];
        clusterEnd = -1;
    };

    for (const item of items) {
        if (cluster.length === 0) {
            cluster = [item];
            clusterEnd = item.endMinutes;
            continue;
        }

        if (item.startMinutes < clusterEnd) {
            cluster.push(item);
            clusterEnd = Math.max(clusterEnd, item.endMinutes);
            continue;
        }

        flushCluster();
        cluster = [item];
        clusterEnd = item.endMinutes;
    }

    flushCluster();

    const timed: PositionedTimedEvent[] = [];
    const due: PositionedDueLineEvent[] = [];
    for (const item of positioned) {
        if (item.kind === "timed") {
            timed.push({
                event: item.event,
                startMinutes: item.startMinutes,
                endMinutes: item.endMinutes,
                top: item.top,
                height: item.height,
                column: item.column,
                columns: item.columns,
            });
        } else {
            due.push({
                event: item.event,
                top: item.top,
                column: item.column,
                columns: item.columns,
            });
        }
    }

    return { timed, due };
}

export function TaskCalendar({
    events,
    onCreateFromSlot,
    onReschedule,
    onOpenTask,
    defaultView = "week",
    className,
}: TaskCalendarProps) {
    const [currentDate, setCurrentDate] = useState<Date>(new Date());
    const [currentTime, setCurrentTime] = useState<Date>(() => new Date());
    const [view, setView] = useState<CalendarView>(() => {
        if (typeof window === "undefined") {
            return defaultView;
        }
        try {
            const savedView = window.localStorage.getItem(CALENDAR_VIEW_STORAGE_KEY);
            if (savedView && isCalendarView(savedView)) {
                return savedView;
            }
        } catch {
            // Ignore localStorage access failures and keep the provided default view.
        }
        return defaultView;
    });
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const pendingCreateClickTimeoutsRef = useRef<Map<string, number>>(new Map());
    const pendingMonthCellCreateTimeoutRef = useRef<number | null>(null);

    useEffect(() => {
        try {
            window.localStorage.setItem(CALENDAR_VIEW_STORAGE_KEY, view);
        } catch {
            // Ignore localStorage write failures.
        }
    }, [view]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setCurrentTime(new Date());
        }, 30_000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        const pendingCreateClickTimeouts = pendingCreateClickTimeoutsRef.current;
        return () => {
            for (const timeoutId of pendingCreateClickTimeouts.values()) {
                window.clearTimeout(timeoutId);
            }
            pendingCreateClickTimeouts.clear();
            if (pendingMonthCellCreateTimeoutRef.current != null) {
                window.clearTimeout(pendingMonthCellCreateTimeoutRef.current);
                pendingMonthCellCreateTimeoutRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (view !== "week" && view !== "day") return;

        const timer = window.setTimeout(() => {
            const container = scrollContainerRef.current;
            if (!container) return;
            const marker = container.querySelector<HTMLElement>('[data-hour-marker="8"]');
            if (!marker) return;
            const stickyHeader =
                view === "week"
                    ? container.querySelector<HTMLElement>('[data-sticky-week-header="true"]')
                    : null;
            const stickyHeaderOffset = stickyHeader ? stickyHeader.offsetHeight : 0;
            container.scrollTop = Math.max(0, marker.offsetTop - stickyHeaderOffset + 1);
        }, 0);

        return () => window.clearTimeout(timer);
    }, [view, currentDate]);

    const eventsById = useMemo(() => {
        return events.reduce((map, event) => {
            map.set(event.id, event);
            return map;
        }, new Map<string, CalendarEvent>());
    }, [events]);

    const navigateDate = (direction: "prev" | "next") => {
        setCurrentDate((prev) => {
            const next = new Date(prev);
            if (view === "month") {
                next.setMonth(prev.getMonth() + (direction === "next" ? 1 : -1));
                return next;
            }

            if (view === "week") {
                next.setDate(prev.getDate() + (direction === "next" ? 7 : -7));
                return next;
            }

            next.setDate(prev.getDate() + (direction === "next" ? 1 : -1));
            return next;
        });
    };

    const getPointerMinutesFromDrag = (event: DragEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const rawMinutes = (event.clientY - rect.top) / PX_PER_MINUTE;
        return snapMinutes(rawMinutes);
    };

    const getPointerMinutesFromClick = (event: MouseEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const rawMinutes = (event.clientY - rect.top) / PX_PER_MINUTE;
        return snapMinutes(rawMinutes);
    };

    const handleDropToDay = (event: DragEvent<HTMLDivElement>, day: Date) => {
        event.preventDefault();
        if (isPastDay(day)) return;
        const taskId = event.dataTransfer.getData("text/task-id");
        if (!taskId) return;

        const draggedEvent = eventsById.get(taskId);
        if (!draggedEvent?.canDrag) return;

        const minutes = getDefaultDropMinutes(draggedEvent);
        const nextDate = dateAtMinutes(day, minutes);
        void onReschedule?.(taskId, nextDate);
    };

    const handleDropToTimedGrid = (event: DragEvent<HTMLDivElement>, day: Date) => {
        event.preventDefault();
        const taskId = event.dataTransfer.getData("text/task-id");
        if (!taskId) return;

        const draggedEvent = eventsById.get(taskId);
        if (!draggedEvent?.canDrag) return;

        const minutes = getPointerMinutesFromDrag(event);
        const nextDate = dateAtMinutes(day, minutes);
        if (isPastSlot(nextDate)) return;
        void onReschedule?.(taskId, nextDate);
    };

    const handleDragStart = (event: DragEvent<HTMLButtonElement>, calendarEvent: CalendarEvent) => {
        if (!calendarEvent.canDrag) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/task-id", calendarEvent.id);
    };

    const clearPendingCreateClick = (eventId: string) => {
        const timeoutId = pendingCreateClickTimeoutsRef.current.get(eventId);
        if (timeoutId == null) return;
        window.clearTimeout(timeoutId);
        pendingCreateClickTimeoutsRef.current.delete(eventId);
    };

    const scheduleCreateFromEvent = (event: { stopPropagation: () => void }, calendarEvent: CalendarEvent) => {
        event.stopPropagation();
        clearPendingCreateClick(calendarEvent.id);
        const timeoutId = window.setTimeout(() => {
            const slotDate = calendarEvent.kind === "timed" ? calendarEvent.start : calendarEvent.end;
            onCreateFromSlot?.(slotDate, view);
            pendingCreateClickTimeoutsRef.current.delete(calendarEvent.id);
        }, 220);
        pendingCreateClickTimeoutsRef.current.set(calendarEvent.id, timeoutId);
    };

    const openTaskFromDoubleClick = (event: { stopPropagation: () => void }, taskId: string) => {
        event.stopPropagation();
        clearPendingCreateClick(taskId);
        onOpenTask?.(taskId);
    };

    const openCreateFromToolbar = () => {
        onCreateFromSlot?.(new Date(), view);
    };

    const clearPendingMonthCellCreate = () => {
        if (pendingMonthCellCreateTimeoutRef.current == null) return;
        window.clearTimeout(pendingMonthCellCreateTimeoutRef.current);
        pendingMonthCellCreateTimeoutRef.current = null;
    };

    const scheduleCreateFromMonthCell = (day: Date) => {
        clearPendingMonthCellCreate();
        pendingMonthCellCreateTimeoutRef.current = window.setTimeout(() => {
            onCreateFromSlot?.(day, "month");
            pendingMonthCellCreateTimeoutRef.current = null;
        }, 220);
    };

    const openDayViewFromMonthCell = (day: Date) => {
        clearPendingMonthCellCreate();
        setCurrentDate(new Date(day));
        setView("day");
    };

    const renderEventChip = (calendarEvent: CalendarEvent, compact = false) => {
        const strikeOverlayStyle = getStrikeOverlayStyle(calendarEvent.status);
        return (
            <button
                key={calendarEvent.id}
                type="button"
                data-calendar-event="true"
                draggable={calendarEvent.canDrag}
                onDragStart={(event) => handleDragStart(event, calendarEvent)}
                onClick={(event) => scheduleCreateFromEvent(event, calendarEvent)}
                onDoubleClick={(event) => openTaskFromDoubleClick(event, calendarEvent.id)}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        openTaskFromDoubleClick(event, calendarEvent.id);
                    }
                }}
                className={cn(
                    "group relative w-full overflow-hidden rounded-none border px-2 py-1.5 text-left transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60",
                    getEventSurfaceClasses(calendarEvent),
                    calendarEvent.canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer opacity-95",
                    compact ? "px-1.5 py-0.5 text-[10px] leading-tight" : "text-xs"
                )}
                title={`${calendarEvent.title} - ${calendarEvent.kind === "due" ? `Due ${formatTime(calendarEvent.end)}` : `${formatTime(calendarEvent.start)} - ${formatTime(calendarEvent.end)}`} - ${statusLabel(calendarEvent.status)}`}
                aria-label={`${calendarEvent.title}, ${calendarEvent.kind === "due" ? `due ${formatTime(calendarEvent.end)}` : `${formatTime(calendarEvent.start)} to ${formatTime(calendarEvent.end)}`}`}
            >
                {strikeOverlayStyle && <span aria-hidden className="pointer-events-none absolute inset-0 z-0" style={strikeOverlayStyle} />}
                <div className="relative z-10 truncate font-medium">{calendarEvent.title}</div>
                {!compact && (
                    <div className="relative z-10 mt-0.5 text-[10px] opacity-85">
                        {calendarEvent.kind === "due" ? `Due ${formatTime(calendarEvent.end)}` : `${formatTime(calendarEvent.start)} - ${formatTime(calendarEvent.end)}`}
                    </div>
                )}
            </button>
        );
    };

    const renderTimedBlock = (item: PositionedTimedEvent) => {
        const { event: calendarEvent } = item;
        const gapPx = 0;
        const strikeOverlayStyle = getStrikeOverlayStyle(calendarEvent.status);

        return (
            <button
                key={calendarEvent.id}
                type="button"
                data-calendar-event="true"
                draggable={calendarEvent.canDrag}
                onDragStart={(event) => handleDragStart(event, calendarEvent)}
                onClick={(event) => scheduleCreateFromEvent(event, calendarEvent)}
                onDoubleClick={(event) => openTaskFromDoubleClick(event, calendarEvent.id)}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        openTaskFromDoubleClick(event, calendarEvent.id);
                    }
                }}
                className={cn(
                    "absolute z-10 overflow-hidden rounded-none border px-2 py-1 text-left transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60",
                    getEventSurfaceClasses(calendarEvent),
                    calendarEvent.canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer opacity-95"
                )}
                style={{
                    top: `${item.top}px`,
                    height: `${item.height}px`,
                    left: `calc(${(item.column / item.columns) * 100}% + ${gapPx / 2}px)`,
                    width: `calc(${100 / item.columns}% - ${gapPx}px)`,
                }}
                title={`${calendarEvent.title} - ${formatTime(calendarEvent.start)} - ${formatTime(calendarEvent.end)} - ${statusLabel(calendarEvent.status)}`}
                aria-label={`${calendarEvent.title}, ${formatTime(calendarEvent.start)} to ${formatTime(calendarEvent.end)}`}
            >
                {strikeOverlayStyle && <span aria-hidden className="pointer-events-none absolute inset-0 z-0" style={strikeOverlayStyle} />}
                <div className="relative z-10 truncate text-[11px] font-semibold leading-tight">{calendarEvent.title}</div>
                <div className="relative z-10 mt-1 text-[10px] opacity-85">
                    {formatTime(calendarEvent.start)} - {formatTime(calendarEvent.end)}
                </div>
            </button>
        );
    };

    const renderDueLineBlock = (item: PositionedDueLineEvent) => {
        const { event: calendarEvent } = item;
        const strikeOverlayStyle = getStrikeOverlayStyle(calendarEvent.status);
        const gapPx = 0;
        return (
            <button
                key={`due-line-${calendarEvent.id}`}
                type="button"
                data-calendar-event="true"
                draggable={calendarEvent.canDrag}
                onDragStart={(event) => handleDragStart(event, calendarEvent)}
                onClick={(event) => scheduleCreateFromEvent(event, calendarEvent)}
                onDoubleClick={(event) => openTaskFromDoubleClick(event, calendarEvent.id)}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        openTaskFromDoubleClick(event, calendarEvent.id);
                    }
                }}
                className={cn(
                    "absolute left-0 right-0 z-20 h-[30px] overflow-hidden border px-2 text-left text-[11px] font-semibold leading-none transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60",
                    getEventSurfaceClasses(calendarEvent),
                    calendarEvent.canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer opacity-95"
                )}
                style={{
                    top: `${item.top}px`,
                    left: `calc(${(item.column / item.columns) * 100}% + ${gapPx / 2}px)`,
                    width: `calc(${100 / item.columns}% - ${gapPx}px)`,
                }}
                title={`${calendarEvent.title} - Due ${formatTime(calendarEvent.end)} - ${statusLabel(calendarEvent.status)}`}
                aria-label={`${calendarEvent.title}, due ${formatTime(calendarEvent.end)}`}
            >
                {strikeOverlayStyle && <span aria-hidden className="pointer-events-none absolute inset-0 z-0" style={strikeOverlayStyle} />}
                <span className="relative z-10 flex h-full items-center">
                    <span className="truncate">{calendarEvent.title}, {formatTime(calendarEvent.end)}</span>
                </span>
            </button>
        );
    };

    const renderMonthEventRow = (calendarEvent: CalendarEvent) => (
        <button
            key={calendarEvent.id}
            type="button"
            data-calendar-event="true"
            draggable={calendarEvent.canDrag}
            onDragStart={(event) => handleDragStart(event, calendarEvent)}
            onClick={(event) => scheduleCreateFromEvent(event, calendarEvent)}
            onDoubleClick={(event) => openTaskFromDoubleClick(event, calendarEvent.id)}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    openTaskFromDoubleClick(event, calendarEvent.id);
                }
            }}
            className={cn(
                "group flex w-full items-center gap-1.5 rounded-none px-0.5 py-0.5 text-left text-[10px] leading-tight transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60",
                calendarEvent.canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer opacity-95"
            )}
            title={`${calendarEvent.title} - ${calendarEvent.kind === "due" ? `Due ${formatTime(calendarEvent.end)}` : `${formatTime(calendarEvent.start)} - ${formatTime(calendarEvent.end)}`} - ${statusLabel(calendarEvent.status)}`}
            aria-label={`${calendarEvent.title}, ${calendarEvent.kind === "due" ? `due ${formatTime(calendarEvent.end)}` : `${formatTime(calendarEvent.start)} to ${formatTime(calendarEvent.end)}`}`}
        >
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", MONTH_DOT_META[calendarEvent.color])} aria-hidden />
            <span className="min-w-0 truncate text-slate-300/90">
                <span className="font-medium">{formatTime(calendarEvent.kind === "due" ? calendarEvent.end : calendarEvent.start)}</span>{" "}
                <span>{calendarEvent.title}</span>
            </span>
        </button>
    );

    const renderMonth = () => {
        const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const mondayOffset = (firstDayOfMonth.getDay() + 6) % 7;
        const gridStart = new Date(firstDayOfMonth);
        gridStart.setDate(firstDayOfMonth.getDate() - mondayOffset);

        const days = Array.from({ length: 42 }, (_, index) => {
            const day = new Date(gridStart);
            day.setDate(gridStart.getDate() + index);
            return day;
        });

        return (
            <div className="tas-calendar-board overflow-hidden rounded-2xl border border-white/10 md:h-[calc(100dvh-8.2rem)] md:min-h-[560px]">
                <div className="grid shrink-0 grid-cols-7 border-b border-white/10 bg-white/[0.015]">
                    {WEEKDAY_LABELS.map((label) => (
                        <div key={label} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-300/80">
                            {label}
                        </div>
                    ))}
                </div>

                <div className="grid grid-cols-7 md:h-[calc(100%-2.15rem)] md:grid-rows-6">
                    {days.map((day) => {
                        const dayEvents = events
                            .filter((event) => isSameDay(getEventDay(event), day))
                            .sort((a, b) => getEventSortTime(a) - getEventSortTime(b));
                        const inMonth = day.getMonth() === currentDate.getMonth();
                        const today = isSameDay(day, new Date());

                        return (
                            <div
                                key={`${day.toISOString()}-month`}
                                className={cn(
                                    "min-h-[88px] overflow-hidden border-r border-b border-white/10 px-2 py-1.5 transition hover:bg-white/[0.03] md:min-h-0",
                                    !inMonth && "bg-black/20",
                                    "last:border-r-0"
                                )}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => handleDropToDay(event, day)}
                                onClick={() => scheduleCreateFromMonthCell(day)}
                                onDoubleClick={() => openDayViewFromMonthCell(day)}
                            >
                                <div className="flex h-full min-h-0 flex-col overflow-hidden">
                                    <div
                                        className={cn(
                                            "mb-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                                            today ? "bg-cyan-300 text-slate-900" : inMonth ? "text-slate-200" : "text-slate-500"
                                        )}
                                    >
                                        {day.getDate()}
                                    </div>

                                    <div className="min-h-0 space-y-1 overflow-hidden">
                                        {dayEvents.slice(0, MONTH_MAX_VISIBLE_EVENTS).map((event) => renderMonthEventRow(event))}
                                    </div>
                                    {dayEvents.length > MONTH_MAX_VISIBLE_EVENTS && (
                                        <div className="mt-1 shrink-0 truncate pl-0.5 text-[10px] font-medium text-slate-400">
                                            +{dayEvents.length - MONTH_MAX_VISIBLE_EVENTS} more
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    const renderWeek = () => {
        const weekStart = getWeekStartMonday(currentDate);
        const weekDays = Array.from({ length: 7 }, (_, index) => {
            const day = new Date(weekStart);
            day.setDate(weekStart.getDate() + index);
            return day;
        });
        const todayWeekIndex = weekDays.findIndex((day) => isSameDay(day, currentTime));
        const showCurrentTimeInWeek = todayWeekIndex >= 0;
        const currentTimeTop = getCurrentTimeTop(currentTime);

        const dueByDay = weekDays.map((day) =>
            events
                .filter((event) => event.kind === "due" && isSameDay(getEventDay(event), day))
                .sort((a, b) => a.end.getTime() - b.end.getTime())
        );

        const timelineByDay = weekDays.map((day) =>
            buildTimelineLayout(
                events
                    .filter((event) => isSameDay(getEventDay(event), day))
                    .sort((a, b) => getEventSortTime(a) - getEventSortTime(b))
            )
        );

        return (
            <div className="space-y-3">
                <div className="space-y-3 md:hidden">
                    {weekDays.map((day, index) => {
                        const dueEvents = dueByDay[index];
                        const timedEvents = timelineByDay[index].timed.map((item) => item.event);
                        const dayIsPast = isPastDay(day);

                        return (
                            <div
                                key={`${day.toISOString()}-week-mobile`}
                                className={cn(
                                    "tas-calendar-board rounded-2xl border border-white/10 px-3 py-3",
                                    dayIsPast && "bg-black/20"
                                )}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => handleDropToDay(event, day)}
                                onClick={() => {
                                    const slot = dateAtMinutes(day, 9 * 60);
                                    if (isPastSlot(slot)) return;
                                    onCreateFromSlot?.(slot, "week");
                                }}
                            >
                                <div className="mb-3 flex items-center justify-between">
                                    <p className={cn("text-sm font-semibold text-slate-100", dayIsPast && "text-slate-400")}>
                                        {day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                                    </p>
                                    {isSameDay(day, new Date()) && (
                                        <span className="rounded-full border border-cyan-300/30 bg-cyan-300/15 px-2 py-0.5 text-[10px] font-semibold text-cyan-100">
                                            Today
                                        </span>
                                    )}
                                </div>

                                {dueEvents.length > 0 && (
                                    <div className="mb-2 space-y-1.5">
                                        {dueEvents.map((event) => renderEventChip(event, false))}
                                    </div>
                                )}

                                <div className="space-y-1.5">
                                    {timedEvents.length === 0 && dueEvents.length === 0 ? (
                                        <p className="text-xs text-slate-500">No tasks</p>
                                    ) : (
                                        timedEvents.map((event) => renderEventChip(event, false))
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="hidden md:block">
                    <div className="-mr-2 pr-2">
                        <div
                            ref={scrollContainerRef}
                            className="calendar-thin-scroll h-[calc(100dvh-8.2rem)] min-h-[560px] overflow-auto rounded-2xl border border-white/10"
                        >
                            <div className="tas-calendar-board">
                            <div className="min-w-[980px]">
                                <div className="sticky top-0 z-20 overflow-hidden rounded-t-2xl bg-[#081230]" data-sticky-week-header="true">
                                    <div
                                        className="grid border-b border-white/10 bg-[linear-gradient(180deg,#081230,#071127)]"
                                        style={{ gridTemplateColumns: "72px repeat(7, minmax(0, 1fr))", height: `${HOUR_HEIGHT}px` }}
                                    >
                                        <div className="flex items-center border-r border-white/10 px-2">
                                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Due</p>
                                        </div>
                                        {weekDays.map((day, index) => {
                                            const isToday = isSameDay(day, new Date());
                                            const dueEvents = dueByDay[index];
                                            const dayIsPast = isPastDay(day);
                                            return (
                                                <div
                                                    key={`${day.toISOString()}-week-header`}
                                                    className={cn(
                                                        "h-full px-2 py-1.5 transition",
                                                        !dayIsPast && "hover:bg-white/[0.03]",
                                                        dayIsPast && "bg-black/20",
                                                        index > 0 && "border-l border-white/10"
                                                    )}
                                                    onDragOver={(event) => event.preventDefault()}
                                                    onDrop={(event) => handleDropToDay(event, day)}
                                                    onClick={() => {
                                                        const slot = dateAtMinutes(day, 9 * 60);
                                                        if (isPastSlot(slot)) return;
                                                        onCreateFromSlot?.(slot, "week");
                                                    }}
                                                >
                                                    <div className="flex items-center justify-between gap-1">
                                                        <div className={cn("text-[10px] font-semibold uppercase tracking-wide text-slate-300/85", dayIsPast && "text-slate-500")}>
                                                            {WEEKDAY_LABELS[index]}
                                                        </div>
                                                        <div
                                                            className={cn(
                                                                "text-xl leading-none text-slate-200/90",
                                                                isToday && "text-cyan-200",
                                                                dayIsPast && "text-slate-500"
                                                            )}
                                                        >
                                                            {day.getDate()}
                                                        </div>
                                                    </div>
                                                    {dueEvents.length > 0 && (
                                                        <p className={cn("mt-0.5 text-[10px] font-medium text-slate-400", dayIsPast && "text-slate-600")}>
                                                            {dueEvents.length} due
                                                        </p>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="relative flex" style={{ height: `${TIMELINE_HEIGHT}px` }}>
                                    <div className="relative w-[72px] border-r border-white/10 bg-black/20">
                                        {HOURS.map((hour) => (
                                            <div
                                                key={`week-time-${hour}`}
                                                data-hour-marker={hour}
                                                className="pointer-events-none absolute left-0 right-0 border-t border-white/8"
                                                style={{ top: `${hour * HOUR_HEIGHT}px` }}
                                            >
                                                <span className="-mt-2 inline-block px-2 text-[10px] text-slate-500">{formatHour(hour)}</span>
                                            </div>
                                        ))}
                                        {showCurrentTimeInWeek && (
                                            <div
                                                className="pointer-events-none absolute z-30 h-3 w-3 rounded-full border border-rose-200/70 bg-rose-400"
                                                style={{ top: `${currentTimeTop - 6}px`, right: "-7px" }}
                                                aria-hidden
                                            />
                                        )}
                                    </div>

                                    <div className="grid flex-1 grid-cols-7">
                                        {weekDays.map((day, index) => {
                                            const dayIsPast = isPastDay(day);
                                            return (
                                                <div
                                                    key={`${day.toISOString()}-week-grid`}
                                                    className={cn("relative overflow-hidden", dayIsPast && "bg-black/20", index > 0 && "border-l border-white/10")}
                                                    onDragOver={(event) => event.preventDefault()}
                                                    onDrop={(event) => handleDropToTimedGrid(event, day)}
                                                    onClick={(event) => {
                                                        const minutes = getPointerMinutesFromClick(event);
                                                        const slot = dateAtMinutes(day, minutes);
                                                        if (isPastSlot(slot)) return;
                                                        onCreateFromSlot?.(slot, "week");
                                                    }}
                                                >
                                                    {HOURS.map((hour) => (
                                                        <div
                                                            key={`${day.toISOString()}-line-${hour}`}
                                                            data-hour-marker={index === 0 ? hour : undefined}
                                                            className="pointer-events-none absolute left-0 right-0 border-t border-white/8"
                                                            style={{ top: `${hour * HOUR_HEIGHT}px` }}
                                                        />
                                                    ))}
                                                    {showCurrentTimeInWeek && index === todayWeekIndex && (
                                                        <div
                                                            className="pointer-events-none absolute left-0 right-0 z-20 border-t-2 border-rose-400"
                                                            style={{ top: `${currentTimeTop}px` }}
                                                            aria-hidden
                                                        />
                                                    )}
                                                    <div className="relative h-full">
                                                        {timelineByDay[index].due.map((item) => renderDueLineBlock(item))}
                                                        {timelineByDay[index].timed.map((item) => renderTimedBlock(item))}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderDay = () => {
        const dayIsPast = isPastDay(currentDate);
        const showCurrentTimeInDay = isSameDay(currentDate, currentTime);
        const currentTimeTop = getCurrentTimeTop(currentTime);

        const dayTimelineLayout = buildTimelineLayout(
            events
                .filter((event) => isSameDay(getEventDay(event), currentDate))
                .sort((a, b) => getEventSortTime(a) - getEventSortTime(b))
        );
        const timedLayout = dayTimelineLayout.timed;
        const dueLineLayout = dayTimelineLayout.due;

        return (
            <div className={cn("tas-calendar-board overflow-hidden rounded-2xl border border-white/10", dayIsPast && "bg-black/20")}>
                <div ref={scrollContainerRef} className="calendar-thin-scroll h-[calc(100dvh-8.2rem)] min-h-[560px] overflow-auto">
                    <div className="relative flex" style={{ height: `${TIMELINE_HEIGHT}px` }}>
                        <div className="relative w-[72px] border-r border-white/10 bg-black/20">
                            {HOURS.map((hour) => (
                                <div
                                    key={`day-time-${hour}`}
                                    data-hour-marker={hour}
                                    className="pointer-events-none absolute left-0 right-0 border-t border-white/8"
                                    style={{ top: `${hour * HOUR_HEIGHT}px` }}
                                >
                                    <span className="-mt-2 inline-block px-2 text-[10px] text-slate-500">{formatHour(hour)}</span>
                                </div>
                            ))}
                            {showCurrentTimeInDay && (
                                <div
                                    className="pointer-events-none absolute z-30 h-3 w-3 rounded-full border border-rose-200/70 bg-rose-400"
                                    style={{ top: `${currentTimeTop - 6}px`, right: "-7px" }}
                                    aria-hidden
                                />
                            )}
                        </div>

                        <div
                            className={cn("relative flex-1 overflow-hidden", dayIsPast && "bg-black/20")}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => handleDropToTimedGrid(event, currentDate)}
                            onClick={(event) => {
                                const minutes = getPointerMinutesFromClick(event);
                                const slot = dateAtMinutes(currentDate, minutes);
                                if (isPastSlot(slot)) return;
                                onCreateFromSlot?.(slot, "day");
                            }}
                        >
                            {HOURS.map((hour) => (
                                <div
                                    key={`day-line-${hour}`}
                                    data-hour-marker={hour}
                                    className="pointer-events-none absolute left-0 right-0 border-t border-white/8"
                                    style={{ top: `${hour * HOUR_HEIGHT}px` }}
                                />
                            ))}
                            {showCurrentTimeInDay && (
                                <div
                                    className="pointer-events-none absolute left-0 right-0 z-20 border-t-2 border-rose-400"
                                    style={{ top: `${currentTimeTop}px` }}
                                    aria-hidden
                                />
                            )}
                            <div className="relative h-full">
                                {dueLineLayout.map((item) => renderDueLineBlock(item))}
                                {timedLayout.map((item) => renderTimedBlock(item))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderList = () => {
        const grouped = events.reduce((map, event) => {
            const key = getEventDay(event).toISOString();
            const current = map.get(key) || [];
            current.push(event);
            map.set(key, current);
            return map;
        }, new Map<string, CalendarEvent[]>());

        const orderedGroups = [...grouped.entries()].sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime());

        return (
            <div
                className="space-y-5"
                onClick={() => {
                    onCreateFromSlot?.(new Date(), "list");
                }}
            >
                {orderedGroups.length === 0 && (
                    <div className="tas-calendar-board rounded-2xl border border-white/10 px-4 py-8 text-center text-sm text-slate-500">
                        No tasks scheduled.
                    </div>
                )}

                {orderedGroups.map(([dayIso, dayEvents]) => {
                    const date = new Date(dayIso);
                    const sorted = [...dayEvents].sort((a, b) => getEventSortTime(a) - getEventSortTime(b));

                    return (
                        <section
                            key={dayIso}
                            className="space-y-2"
                            onClick={() => {
                                onCreateFromSlot?.(date, "list");
                            }}
                        >
                            <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                                {date.toLocaleDateString(undefined, {
                                    weekday: "long",
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric",
                                })}
                            </h3>

                            <div className="space-y-2">
                                {sorted.map((event) => (
                                    (() => {
                                        const strikeOverlayStyle = getStrikeOverlayStyle(event.status);
                                        return (
                                            <button
                                                key={event.id}
                                                type="button"
                                                onClick={(interactionEvent) => scheduleCreateFromEvent(interactionEvent, event)}
                                                onDoubleClick={(interactionEvent) => openTaskFromDoubleClick(interactionEvent, event.id)}
                                                onKeyDown={(interactionEvent) => {
                                                    if (interactionEvent.key === "Enter" || interactionEvent.key === " ") {
                                                        openTaskFromDoubleClick(interactionEvent, event.id);
                                                    }
                                                }}
                                                className="tas-calendar-board relative flex w-full items-start justify-between gap-3 overflow-hidden rounded-none border border-white/10 px-3 py-3 text-left transition hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                                            >
                                                {strikeOverlayStyle && <span aria-hidden className="pointer-events-none absolute inset-0 z-0" style={strikeOverlayStyle} />}
                                                <div className="relative z-10 min-w-0">
                                                    <p className="truncate text-sm font-semibold text-slate-100">{event.title}</p>
                                                    <p className="mt-1 text-xs text-slate-400">
                                                        {event.kind === "due" ? `Due ${formatTime(event.end)}` : `${formatTime(event.start)} - ${formatTime(event.end)}`}
                                                    </p>
                                                </div>

                                                <div className="relative z-10 flex items-center gap-2">
                                                    <Badge variant="outline" className="border-white/15 bg-black/20 text-[10px] uppercase tracking-wide text-slate-300">
                                                        {statusLabel(event.status)}
                                                    </Badge>
                                                </div>
                                            </button>
                                        );
                                    })()
                                ))}
                            </div>
                        </section>
                    );
                })}
            </div>
        );
    };

    return (
        <div className={cn("tas-calendar-fade-in space-y-2", className)}>
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentDate(new Date())}
                        className="border-white/15 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                    >
                        Today
                    </Button>

                    <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        onClick={() => navigateDate("prev")}
                        className="border-white/15 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                        aria-label="Go to previous date range"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        onClick={() => navigateDate("next")}
                        className="border-white/15 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                        aria-label="Go to next date range"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>

                    <h2 className="ml-1 text-xl font-semibold tracking-tight text-slate-100 sm:text-2xl">{getRangeTitle(view, currentDate)}</h2>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <div className="sm:hidden">
                        <Select
                            value={view}
                            onValueChange={(value) => {
                                if (isCalendarView(value)) {
                                    setView(value);
                                }
                            }}
                        >
                            <SelectTrigger className="w-[120px] border-white/15 bg-white/[0.03] text-slate-100">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="month">Month</SelectItem>
                                <SelectItem value="week">Week</SelectItem>
                                <SelectItem value="day">Day</SelectItem>
                                <SelectItem value="list">List</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="hidden overflow-hidden rounded-full border border-white/15 bg-white/[0.03] p-1 sm:flex">
                        {["month", "week", "day", "list"].map((value) => (
                            <Button
                                key={value}
                                type="button"
                                variant={view === value ? "secondary" : "ghost"}
                                size="sm"
                                onClick={() => setView(value as CalendarView)}
                                className={cn(
                                    "rounded-full px-3 text-xs font-semibold uppercase tracking-wide",
                                    view === value
                                        ? "bg-cyan-200/90 text-slate-900 hover:bg-cyan-200"
                                        : "text-slate-300 hover:bg-white/[0.08] hover:text-slate-100"
                                )}
                            >
                                {value}
                            </Button>
                        ))}
                    </div>

                    <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        onClick={openCreateFromToolbar}
                        className="border-white/15 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                        aria-label="Create task"
                        title="Create task"
                    >
                        <Plus className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {view === "month" && renderMonth()}
            {view === "week" && renderWeek()}
            {view === "day" && renderDay()}
            {view === "list" && renderList()}
        </div>
    );
}
