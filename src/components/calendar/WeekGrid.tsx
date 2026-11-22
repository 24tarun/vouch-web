"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ExternalLink, GripVertical, Lock, Repeat } from "lucide-react";

import { cn } from "@/lib/utils";
import {
    SLOT_MINUTES,
    SLOT_MS,
    SLOTS_PER_DAY,
    addLocalDays,
    dateAtSlot,
    groupDeadlinePins,
    layoutOverlaps,
    localDayKey,
    minutesIntoDay,
    startOfLocalDay,
    type DeadlinePinGroup,
} from "@/lib/calendar/grid";
import { validatePostponeTarget } from "@/lib/calendar/pins";
import type { CalendarBlock } from "@/lib/calendar/types";
import { blockItemKey, splitIntoDaySegments, type CalendarItem, type WeekModel } from "./model";
import { TODAY_GLOW_STYLE, statusDotClass, statusFillColor } from "./tints";

// Days are rows, time runs left→right; the grid scrolls horizontally.
export const HOUR_PX = 96;
const SLOT_PX = HOUR_PX / (60 / SLOT_MINUTES);
const GRID_WIDTH = HOUR_PX * 24;
const GUTTER_PX = 64;
const INITIAL_SCROLL_HOUR = 5;
const DRAG_THRESHOLD_PX = 3;
const AUTO_SCROLL_EDGE_PX = 40;
const AUTO_SCROLL_STEP_PX = 14;

export interface SlotSelection {
    dayIndex: number;
    startSlot: number;
    endSlot: number;
}

type Drag =
    | { kind: "create"; dayIndex: number; anchorSlot: number; currentSlot: number; moved: boolean }
    | {
        kind: "move";
        blockId: string;
        origStartMs: number;
        origEndMs: number;
        startX: number;
        startY: number;
        startDay: number;
        startSlotFloat: number;
        deltaDays: number;
        deltaSlots: number;
        deadlineMs: number;
        moved: boolean;
        draggable: boolean;
    }
    | { kind: "resize"; blockId: string; origStartMs: number; origEndMs: number; startSlotFloat: number; deltaSlots: number; maxEndMs: number }
    | { kind: "pin"; itemKey: string; origDeadlineMs: number; startX: number; startY: number; dayIndex: number; slot: number; moved: boolean };

interface PinPopoverState {
    groupKey: string;
    rect: DOMRect;
}

interface WeekGridProps {
    weekStart: Date;
    now: Date;
    model: WeekModel;
    hoveredKey: string | null;
    onHoverKey: (key: string | null) => void;
    selectedBlockId: string | null;
    pendingSelection: SlotSelection | null;
    onCreateSelection: (selection: SlotSelection, anchor: DOMRect) => void;
    onBlockCommit: (blockId: string, startMs: number, endMs: number) => void;
    onBlockClick: (blockId: string, anchor: DOMRect) => void;
    onPinDrop: (itemKey: string, newDeadlineMs: number) => void;
    onDragActiveChange: (active: boolean) => void;
    onInvalidDrop: (message: string) => void;
}

function shiftMs(ms: number, days: number, slots: number): number {
    const date = new Date(ms);
    date.setDate(date.getDate() + days);
    return date.getTime() + slots * SLOT_MS;
}

function floorToSlot(ms: number): number {
    return ms - (((ms % SLOT_MS) + SLOT_MS) % SLOT_MS);
}

function isSameLocalDay(aMs: number, bMs: number): boolean {
    return localDayKey(new Date(aMs)) === localDayKey(new Date(bMs));
}

/** New deadline under the pointer, keeping the original minutes within its 15-minute cell (e.g. :59). */
function pinTargetMs(current: Extract<Drag, { kind: "pin" }>, weekStart: Date): number {
    const offsetWithinSlot = current.origDeadlineMs - floorToSlot(current.origDeadlineMs);
    const day = addLocalDays(startOfLocalDay(weekStart), current.dayIndex);
    return dateAtSlot(day, current.slot).getTime() + offsetWithinSlot;
}

function formatRange(startMs: number, endMs: number): string {
    return `${format(startMs, "HH:mm")}–${format(endMs, "HH:mm")}`;
}

function slotSelectionRange(selection: SlotSelection) {
    return { left: selection.startSlot * SLOT_PX, width: (selection.endSlot - selection.startSlot) * SLOT_PX };
}

export function WeekGrid({
    weekStart,
    now,
    model,
    hoveredKey,
    onHoverKey,
    selectedBlockId,
    pendingSelection,
    onCreateSelection,
    onBlockCommit,
    onBlockClick,
    onPinDrop,
    onDragActiveChange,
    onInvalidDrop,
}: WeekGridProps) {
    const scrollerRef = useRef<HTMLDivElement>(null);
    const rowsRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<Drag | null>(null);
    const [drag, setDrag] = useState<Drag | null>(null);
    const [pinPopover, setPinPopover] = useState<PinPopoverState | null>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const suppressPinClickRef = useRef(false);
    // Latest callbacks/values, so window listeners registered at drag start stay valid across re-renders.
    const latestRef = useRef({ onCreateSelection, onBlockCommit, onBlockClick, onPinDrop, onDragActiveChange, onInvalidDrop, weekStart });
    useLayoutEffect(() => {
        latestRef.current = { onCreateSelection, onBlockCommit, onBlockClick, onPinDrop, onDragActiveChange, onInvalidDrop, weekStart };
    });

    const days = useMemo(
        () => Array.from({ length: 7 }, (_, index) => addLocalDays(startOfLocalDay(weekStart), index)),
        [weekStart]
    );
    const todayKey = localDayKey(now);

    useLayoutEffect(() => {
        if (scrollerRef.current) scrollerRef.current.scrollLeft = INITIAL_SCROLL_HOUR * HOUR_PX - 12;
    }, []);

    // ---------- geometry ----------
    const getCell = useCallback((clientX: number, clientY: number) => {
        const rect = rowsRef.current?.getBoundingClientRect();
        if (!rect) return { dayIndex: 0, slotFloat: 0 };
        const rowHeight = rect.height / 7;
        const dayIndex = Math.max(0, Math.min(6, Math.floor((clientY - rect.top) / rowHeight)));
        const slotFloat = Math.max(0, Math.min(SLOTS_PER_DAY - 0.001, (clientX - rect.left) / SLOT_PX));
        return { dayIndex, slotFloat };
    }, []);

    const autoScroll = useCallback((clientX: number) => {
        const scroller = scrollerRef.current;
        if (!scroller) return;
        const rect = scroller.getBoundingClientRect();
        if (clientX < rect.left + GUTTER_PX + AUTO_SCROLL_EDGE_PX) scroller.scrollLeft -= AUTO_SCROLL_STEP_PX;
        else if (clientX > rect.right - AUTO_SCROLL_EDGE_PX) scroller.scrollLeft += AUTO_SCROLL_STEP_PX;
    }, []);

    // ---------- drag lifecycle ----------
    const updateDrag = useCallback((next: Drag | null) => {
        dragRef.current = next;
        setDrag(next);
    }, []);

    const handleMove = useCallback((event: PointerEvent) => {
        const current = dragRef.current;
        if (!current) return;
        autoScroll(event.clientX);
        const cell = getCell(event.clientX, event.clientY);

        if (current.kind === "create") {
            const currentSlot = Math.floor(cell.slotFloat);
            if (currentSlot !== current.currentSlot) updateDrag({ ...current, currentSlot, moved: true });
            return;
        }
        if (current.kind === "move") {
            const moved = current.moved
                || Math.abs(event.clientX - current.startX) > DRAG_THRESHOLD_PX
                || Math.abs(event.clientY - current.startY) > DRAG_THRESHOLD_PX;
            if (!current.draggable) {
                if (moved !== current.moved) updateDrag({ ...current, moved });
                return;
            }
            // Measured in grid slots (not pointer px) so auto-scroll during the drag is accounted for.
            const deltaSlots = Math.round(cell.slotFloat - current.startSlotFloat);
            const deltaDays = cell.dayIndex - current.startDay;
            if (moved !== current.moved || deltaSlots !== current.deltaSlots || deltaDays !== current.deltaDays) {
                updateDrag({ ...current, moved, deltaSlots, deltaDays });
            }
            return;
        }
        if (current.kind === "resize") {
            const deltaSlots = Math.round(cell.slotFloat - current.startSlotFloat);
            if (deltaSlots !== current.deltaSlots) updateDrag({ ...current, deltaSlots });
            return;
        }
        if (current.kind === "pin") {
            const moved = current.moved
                || Math.abs(event.clientX - current.startX) > DRAG_THRESHOLD_PX
                || Math.abs(event.clientY - current.startY) > DRAG_THRESHOLD_PX;
            const slot = Math.min(SLOTS_PER_DAY - 1, Math.floor(cell.slotFloat));
            if (moved && !current.moved) setPinPopover(null);
            if (moved !== current.moved || slot !== current.slot || cell.dayIndex !== current.dayIndex) {
                updateDrag({ ...current, moved, slot, dayIndex: cell.dayIndex });
            }
        }
    }, [autoScroll, getCell, updateDrag]);

    const handleUpRef = useRef<(event: PointerEvent) => void>(() => undefined);
    const detachListeners = useCallback(() => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUpRef.current);
        window.removeEventListener("pointercancel", handleUpRef.current);
    }, [handleMove]);

    const handleUp = useCallback((event: PointerEvent) => {
        const current = dragRef.current;
        const { onCreateSelection, onBlockCommit, onBlockClick, onPinDrop, onDragActiveChange, onInvalidDrop } = latestRef.current;
        detachListeners();
        updateDrag(null);
        onDragActiveChange(false);
        if (!current || event.type === "pointercancel") return;

        if (current.kind === "create") {
            const startSlot = Math.min(current.anchorSlot, current.currentSlot);
            const endSlot = Math.max(current.anchorSlot, current.currentSlot) + 1;
            const rows = rowsRef.current?.getBoundingClientRect();
            if (!rows) return;
            const rowHeight = rows.height / 7;
            const anchor = new DOMRect(
                rows.left + startSlot * SLOT_PX,
                rows.top + current.dayIndex * rowHeight,
                (endSlot - startSlot) * SLOT_PX,
                rowHeight
            );
            onCreateSelection({ dayIndex: current.dayIndex, startSlot, endSlot }, anchor);
            return;
        }
        if (current.kind === "move") {
            if (!current.moved) {
                const element = document.querySelector(`[data-block-id="${current.blockId}"]`);
                onBlockClick(current.blockId, element?.getBoundingClientRect() ?? new DOMRect(event.clientX, event.clientY, 0, 0));
                return;
            }
            if (!current.draggable) return;
            const startMs = shiftMs(current.origStartMs, current.deltaDays, current.deltaSlots);
            const endMs = shiftMs(current.origEndMs, current.deltaDays, current.deltaSlots);
            if (startMs === current.origStartMs) return;
            if (endMs > current.deadlineMs) {
                onInvalidDrop("A block cannot end after the task deadline.");
                return;
            }
            if (!isSameLocalDay(startMs, endMs - 1)) {
                onInvalidDrop("Blocks can't cross midnight.");
                return;
            }
            onBlockCommit(current.blockId, startMs, endMs);
            return;
        }
        if (current.kind === "resize") {
            const endMs = Math.min(current.maxEndMs, Math.max(current.origStartMs + SLOT_MS, current.origEndMs + current.deltaSlots * SLOT_MS));
            if (endMs !== current.origEndMs) onBlockCommit(current.blockId, current.origStartMs, endMs);
            return;
        }
        if (current.kind === "pin") {
            if (!current.moved) return;
            suppressPinClickRef.current = true;
            const targetMs = pinTargetMs(current, latestRef.current.weekStart);
            if (targetMs === current.origDeadlineMs) return;
            onPinDrop(current.itemKey, targetMs);
        }
    }, [detachListeners, updateDrag]);
    useLayoutEffect(() => {
        handleUpRef.current = handleUp;
    }, [handleUp]);

    const beginDrag = useCallback((initial: Drag, event: ReactPointerEvent) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        if (initial.kind !== "pin") setPinPopover(null);
        detachListeners();
        updateDrag(initial);
        latestRef.current.onDragActiveChange(true);
        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", handleUpRef.current);
        window.addEventListener("pointercancel", handleUpRef.current);
    }, [detachListeners, handleMove, updateDrag]);

    // Detach on unmount only (handlers are stable; see latestRef).
    useEffect(() => () => detachListeners(), [detachListeners]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            if (dragRef.current) {
                detachListeners();
                updateDrag(null);
                latestRef.current.onDragActiveChange(false);
            }
            setPinPopover(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [detachListeners, updateDrag]);

    useEffect(() => {
        if (!pinPopover) return;
        const onDown = (event: PointerEvent) => {
            if (popoverRef.current?.contains(event.target as Node)) return;
            if ((event.target as HTMLElement | null)?.closest?.("[data-pin-chip]")) return;
            setPinPopover(null);
        };
        window.addEventListener("pointerdown", onDown);
        return () => window.removeEventListener("pointerdown", onDown);
    }, [pinPopover]);

    // ---------- derived layout ----------
    // Blocks and event windows share one side-by-side layout so neither hides the other.
    const { blockSegmentsByDay, spanSegmentsByDay } = useMemo(() => {
        type Placed = { left: number; width: number; column: number; columns: number };
        type BlockEntry = { block: CalendarBlock; item: CalendarItem; segmentKey: string };
        type SpanEntry = { item: CalendarItem; key: string };
        const blocksOut: Array<Array<BlockEntry & Placed>> = Array.from({ length: 7 }, () => []);
        const spansOut: Array<Array<SpanEntry & Placed>> = Array.from({ length: 7 }, () => []);
        const raw: Array<Array<{ id: string; startMinutes: number; endMinutes: number; block?: BlockEntry; span?: SpanEntry }>> =
            Array.from({ length: 7 }, () => []);

        for (const block of model.blocks) {
            const item = model.itemsByKey.get(blockItemKey(block));
            if (!item) continue;
            splitIntoDaySegments(Date.parse(block.start_at), Date.parse(block.end_at), weekStart).forEach((segment, index) => {
                const segmentKey = `${block.id}:${index}`;
                raw[segment.dayIndex].push({ id: segmentKey, startMinutes: segment.startMinutes, endMinutes: segment.endMinutes, block: { block, item, segmentKey } });
            });
        }
        for (const item of model.weekItems) {
            if (!item.isEvent || item.spanStartMs === null || item.spanStartMs >= item.deadlineMs) continue;
            splitIntoDaySegments(item.spanStartMs, item.deadlineMs, weekStart).forEach((segment, index) => {
                const key = `${item.key}:span:${index}`;
                raw[segment.dayIndex].push({ id: key, startMinutes: segment.startMinutes, endMinutes: segment.endMinutes, span: { item, key } });
            });
        }

        raw.forEach((entries, dayIndex) => {
            const layout = layoutOverlaps(entries.map((entry) => ({ id: entry.id, startMs: entry.startMinutes, endMs: entry.endMinutes })));
            for (const entry of entries) {
                const slot = layout.get(entry.id) ?? { column: 0, columns: 1 };
                const placed: Placed = {
                    left: (entry.startMinutes / 60) * HOUR_PX,
                    width: Math.max(SLOT_PX, ((entry.endMinutes - entry.startMinutes) / 60) * HOUR_PX),
                    column: slot.column,
                    columns: slot.columns,
                };
                if (entry.block) blocksOut[dayIndex].push({ ...entry.block, ...placed });
                if (entry.span) spansOut[dayIndex].push({ ...entry.span, ...placed });
            }
        });
        return { blockSegmentsByDay: blocksOut, spanSegmentsByDay: spansOut };
    }, [model.blocks, model.itemsByKey, model.weekItems, weekStart]);

    const pinGroups = useMemo(() => {
        const groups = groupDeadlinePins(model.weekItems.map((item) => ({ id: item.key, deadlineIso: item.deadlineIso })));
        return groups.map((group) => ({
            group,
            items: group.items.map((entry) => model.itemsByKey.get(entry.id)).filter((item): item is CalendarItem => Boolean(item)),
        }));
    }, [model.itemsByKey, model.weekItems]);

    const pinGroupsByDay = useMemo(() => {
        const byDay = new Map<string, typeof pinGroups>();
        for (const entry of pinGroups) {
            const list = byDay.get(entry.group.dayKey) || [];
            list.push(entry);
            byDay.set(entry.group.dayKey, list);
        }
        return byDay;
    }, [pinGroups]);

    // ---------- drag previews ----------
    const movePreview = useMemo(() => {
        if (!drag || drag.kind !== "move" || !drag.moved || !drag.draggable) return null;
        const startMs = shiftMs(drag.origStartMs, drag.deltaDays, drag.deltaSlots);
        const endMs = shiftMs(drag.origEndMs, drag.deltaDays, drag.deltaSlots);
        const valid = endMs <= drag.deadlineMs && isSameLocalDay(startMs, endMs - 1);
        return { blockId: drag.blockId, startMs, endMs, valid };
    }, [drag]);

    const resizePreview = useMemo(() => {
        if (!drag || drag.kind !== "resize") return null;
        const endMs = Math.min(drag.maxEndMs, Math.max(drag.origStartMs + SLOT_MS, drag.origEndMs + drag.deltaSlots * SLOT_MS));
        return { blockId: drag.blockId, startMs: drag.origStartMs, endMs, atLimit: endMs === drag.maxEndMs && drag.deltaSlots > 0 };
    }, [drag]);

    const pinPreview = useMemo(() => {
        if (!drag || drag.kind !== "pin" || !drag.moved) return null;
        const item = model.itemsByKey.get(drag.itemKey);
        const targetMs = pinTargetMs(drag, weekStart);
        const error = item?.task ? validatePostponeTarget(item.task, targetMs, now) : "Locked";
        return { item, targetMs, error: error === "Deadline unchanged." ? null : error };
    }, [drag, model.itemsByKey, now, weekStart]);

    const createPreview: SlotSelection | null = drag?.kind === "create"
        ? {
            dayIndex: drag.dayIndex,
            startSlot: Math.min(drag.anchorSlot, drag.currentSlot),
            endSlot: Math.max(drag.anchorSlot, drag.currentSlot) + 1,
        }
        : pendingSelection;

    // ---------- handlers ----------
    const onRowPointerDown = (dayIndex: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
        const cell = getCell(event.clientX, event.clientY);
        const slot = Math.floor(cell.slotFloat);
        beginDrag({ kind: "create", dayIndex, anchorSlot: slot, currentSlot: slot, moved: false }, event);
    };

    const onBlockPointerDown = (block: CalendarBlock, item: CalendarItem) => (event: ReactPointerEvent<HTMLDivElement>) => {
        beginDrag({
            kind: "move",
            blockId: block.id,
            origStartMs: Date.parse(block.start_at),
            origEndMs: Date.parse(block.end_at),
            startX: event.clientX,
            startY: event.clientY,
            startDay: getCell(event.clientX, event.clientY).dayIndex,
            startSlotFloat: getCell(event.clientX, event.clientY).slotFloat,
            deltaDays: 0,
            deltaSlots: 0,
            deadlineMs: item.deadlineMs,
            moved: false,
            draggable: item.open && item.canHaveBlocks,
        }, event);
    };

    const onResizePointerDown = (block: CalendarBlock, item: CalendarItem) => (event: ReactPointerEvent<HTMLDivElement>) => {
        const startMs = Date.parse(block.start_at);
        const nextMidnight = addLocalDays(startOfLocalDay(new Date(startMs)), 1).getTime();
        beginDrag({
            kind: "resize",
            blockId: block.id,
            origStartMs: startMs,
            origEndMs: Date.parse(block.end_at),
            startSlotFloat: getCell(event.clientX, event.clientY).slotFloat,
            deltaSlots: 0,
            maxEndMs: Math.max(Date.parse(block.end_at), Math.min(nextMidnight, floorToSlot(item.deadlineMs))),
        }, event);
    };

    const startPinDrag = (item: CalendarItem, event: ReactPointerEvent) => {
        const cell = getCell(event.clientX, event.clientY);
        beginDrag({
            kind: "pin",
            itemKey: item.key,
            origDeadlineMs: item.deadlineMs,
            startX: event.clientX,
            startY: event.clientY,
            dayIndex: cell.dayIndex,
            slot: Math.floor(cell.slotFloat),
            moved: false,
        }, event);
    };

    const onPinChipPointerDown = (group: DeadlinePinGroup<{ id: string; deadlineIso: string }>, items: CalendarItem[]) =>
        (event: ReactPointerEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            suppressPinClickRef.current = false;
            if (items.length === 1 && items[0].lockReason === null) {
                startPinDrag(items[0], event);
                // A click without movement opens the popover (see onClick).
            }
        };

    const togglePinPopover = (groupKey: string, element: HTMLElement) => {
        if (suppressPinClickRef.current) {
            suppressPinClickRef.current = false;
            return;
        }
        setPinPopover((current) => current?.groupKey === groupKey ? null : { groupKey, rect: element.getBoundingClientRect() });
    };

    const popoverGroup = pinPopover ? pinGroups.find((entry) => entry.group.key === pinPopover.groupKey) : null;

    // ---------- render ----------
    return (
        <div className="relative">
            <div
                ref={scrollerRef}
                className={cn(
                    "relative h-[calc(100dvh-12rem)] min-h-[480px] overflow-x-auto overflow-y-hidden overscroll-contain",
                    drag && "select-none"
                )}
            >
                <div className="flex h-full flex-col" style={{ width: GUTTER_PX + GRID_WIDTH }}>
                    {/* Hour header */}
                    <div className="flex h-7 shrink-0 border-b border-slate-900/60">
                        <div className="sticky left-0 z-40 shrink-0 bg-slate-950" style={{ width: GUTTER_PX }} />
                        <div className="relative" style={{ width: GRID_WIDTH }}>
                            {Array.from({ length: 24 }, (_, hour) => (
                                <span
                                    key={hour}
                                    className="absolute top-1.5 pl-1 font-mono text-[10px] text-slate-600"
                                    style={{ left: hour * HOUR_PX }}
                                >
                                    {String(hour).padStart(2, "0")}:00
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="flex min-h-0 flex-1">
                        {/* Day gutter */}
                        <div
                            className="sticky left-0 z-40 grid shrink-0 grid-rows-7 bg-slate-950/90 backdrop-blur-md"
                            style={{ width: GUTTER_PX }}
                        >
                            {days.map((day) => {
                                const isToday = localDayKey(day) === todayKey;
                                return (
                                    <div key={day.toISOString()} className="flex flex-col items-center justify-center gap-1 border-b border-slate-900/60">
                                        <span className={cn("font-mono text-[10px] uppercase tracking-[0.12em]", isToday ? "text-white font-bold" : "text-slate-500")}>
                                            {format(day, "EEE")}
                                        </span>
                                        <span
                                            className={cn("text-lg font-medium leading-none", isToday ? "text-blue-50" : "text-slate-300")}
                                            style={isToday ? TODAY_GLOW_STYLE : undefined}
                                        >
                                            {format(day, "d")}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>

                        <div ref={rowsRef} className="relative grid grid-rows-7" style={{ width: GRID_WIDTH }}>
                            {days.map((day, dayIndex) => {
                                const dayKey = localDayKey(day);
                                const isToday = dayKey === todayKey;
                                const dayPins = pinGroupsByDay.get(dayKey) || [];
                                return (
                                    <div
                                        key={dayKey}
                                        className={cn(
                                            "relative border-b border-slate-900/70",
                                            isToday && "bg-slate-900/25",
                                            drag?.kind === "create" ? "cursor-ew-resize" : "cursor-cell"
                                        )}
                                        onPointerDown={onRowPointerDown(dayIndex)}
                                    >
                                        {/* Event / strict windows */}
                                        {spanSegmentsByDay[dayIndex].map(({ item, key, left, width, column, columns }) => {
                                            const body = (
                                                <>
                                                    <div className="flex items-center gap-1 truncate text-xs text-slate-300">
                                                        {item.isStrict && <Lock className="h-3 w-3 shrink-0 text-slate-400" />}
                                                        {item.isGhost && <Repeat className="h-3 w-3 shrink-0 text-slate-500" />}
                                                        <span className="truncate">{item.title}</span>
                                                    </div>
                                                    {width >= SLOT_PX * 3 && columns === 1 && item.spanStartMs !== null && (
                                                        <div className="truncate font-mono text-[10px] text-slate-600">{formatRange(item.spanStartMs, item.deadlineMs)}</div>
                                                    )}
                                                </>
                                            );
                                            const spanStyle = {
                                                left,
                                                width,
                                                top: `calc(${(column * 100) / columns}% + 2px)`,
                                                height: `calc(${100 / columns}% - 4px)`,
                                            };
                                            const className = cn(
                                                "absolute z-0 overflow-hidden rounded-md border border-dashed border-slate-700/80 bg-slate-950 px-2 py-1",
                                                !item.open && "opacity-40"
                                            );
                                            return item.task ? (
                                                <Link
                                                    key={key}
                                                    href={`/tasks/${item.key}`}
                                                    className={className}
                                                    style={spanStyle}
                                                    title={item.isStrict ? "Strict task — locked" : "Event — locked"}
                                                    onPointerDown={(event) => event.stopPropagation()}
                                                >
                                                    {body}
                                                </Link>
                                            ) : (
                                                <div key={key} className={className} style={spanStyle} onPointerDown={(event) => event.stopPropagation()}>
                                                    {body}
                                                </div>
                                            );
                                        })}

                                        {/* Time blocks */}
                                        {blockSegmentsByDay[dayIndex].map(({ block, item, left, width, column, columns, segmentKey }) => {
                                            const isDragged = (movePreview?.blockId === block.id) || (resizePreview?.blockId === block.id);
                                            const heightPct = 100 / columns;
                                            const isLinked = hoveredKey === item.key;
                                            const draggable = item.open && item.canHaveBlocks;
                                            const displayEndMs = resizePreview?.blockId === block.id ? resizePreview.endMs : Date.parse(block.end_at);
                                            const displayWidth = resizePreview?.blockId === block.id
                                                ? Math.max(SLOT_PX, ((displayEndMs - Date.parse(block.start_at)) / 3_600_000) * HOUR_PX)
                                                : width;
                                            return (
                                                <div
                                                    key={segmentKey}
                                                    data-block-id={block.id}
                                                    className={cn(
                                                        "group absolute z-10 overflow-hidden rounded-md px-2 py-1 text-white transition-[box-shadow,opacity,filter] hover:brightness-110",
                                                        item.isGhost && "border border-dashed border-white/40",
                                                        !item.open && "opacity-40",
                                                        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                                                        movePreview?.blockId === block.id && "opacity-30",
                                                        (selectedBlockId === block.id) && "ring-2 ring-white",
                                                        isLinked && selectedBlockId !== block.id && "ring-1 ring-white/60",
                                                        resizePreview?.blockId === block.id && resizePreview.atLimit && "ring-2 ring-red-500"
                                                    )}
                                                    style={{
                                                        backgroundColor: statusFillColor(item.status),
                                                        left,
                                                        width: displayWidth,
                                                        top: `calc(${column * heightPct}% + 2px)`,
                                                        height: `calc(${heightPct}% - 4px)`,
                                                    }}
                                                    onPointerDown={onBlockPointerDown(block, item)}
                                                    onPointerEnter={() => onHoverKey(item.key)}
                                                    onPointerLeave={() => onHoverKey(null)}
                                                >
                                                    <div className="truncate text-xs font-medium leading-tight">{item.title}</div>
                                                    {displayWidth >= SLOT_PX * 3 && columns === 1 && (
                                                        <div className="mt-0.5 truncate font-mono text-[10px] leading-tight text-white/75">
                                                            {formatRange(Date.parse(block.start_at), displayEndMs)}
                                                        </div>
                                                    )}
                                                    {draggable && !isDragged && (
                                                        <div
                                                            className="absolute inset-y-0 right-0 flex w-2 cursor-ew-resize items-center opacity-0 group-hover:opacity-100"
                                                            onPointerDown={onResizePointerDown(block, item)}
                                                        >
                                                            <div className="h-6 w-0.5 rounded-full bg-white/70" />
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}

                                        {/* Moving block preview */}
                                        {movePreview && (() => {
                                            const block = model.blocks.find((entry) => entry.id === movePreview.blockId);
                                            const item = block ? model.itemsByKey.get(blockItemKey(block)) : null;
                                            if (!block || !item) return null;
                                            const segment = splitIntoDaySegments(movePreview.startMs, movePreview.endMs, weekStart).find((entry) => entry.dayIndex === dayIndex);
                                            if (!segment) return null;
                                            return (
                                                <div
                                                    className={cn(
                                                        "pointer-events-none absolute inset-y-0.5 z-30 overflow-hidden rounded-md px-2 py-1 text-white shadow-lg shadow-black/60",
                                                        !movePreview.valid && "ring-2 ring-red-400"
                                                    )}
                                                    style={{
                                                        backgroundColor: movePreview.valid ? statusFillColor(item.status) : "#7f1d1d",
                                                        left: (segment.startMinutes / 60) * HOUR_PX,
                                                        width: Math.max(SLOT_PX, ((segment.endMinutes - segment.startMinutes) / 60) * HOUR_PX),
                                                    }}
                                                >
                                                    <div className="truncate text-xs font-medium leading-tight">{item.title}</div>
                                                    <div className={cn("mt-0.5 truncate font-mono text-[10px] leading-tight", movePreview.valid ? "text-white/75" : "text-red-200")}>
                                                        {movePreview.valid ? formatRange(movePreview.startMs, movePreview.endMs) : "After deadline"}
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        {/* New block selection (15-minute cells) */}
                                        {createPreview && createPreview.dayIndex === dayIndex && (
                                            <div
                                                className="pointer-events-none absolute inset-y-0.5 z-30 overflow-hidden rounded-md bg-white/10 px-2 py-1 ring-1 ring-white/15"
                                                style={{ ...slotSelectionRange(createPreview), boxShadow: "0 0 18px rgba(255, 255, 255, 0.10)" }}
                                            >
                                                <div className="truncate font-mono text-[10px] leading-tight text-slate-200">
                                                    {formatRange(dateAtSlot(day, createPreview.startSlot).getTime(), dateAtSlot(day, createPreview.endSlot).getTime())}
                                                </div>
                                            </div>
                                        )}

                                        {/* Deadline pins */}
                                        {dayPins.map(({ group, items }) => {
                                            if (items.length === 0) return null;
                                            const left = (minutesIntoDay(new Date(group.anchorIso)) / 60) * HOUR_PX;
                                            const single = items.length === 1 ? items[0] : null;
                                            const allClosed = items.every((item) => !item.open);
                                            const allGhost = items.every((item) => item.isGhost);
                                            const isLinked = items.some((item) => item.key === hoveredKey);
                                            const isDraggingThis = drag?.kind === "pin" && drag.moved && items.some((item) => item.key === drag.itemKey);
                                            return (
                                                <div
                                                    key={group.key}
                                                    className={cn("pointer-events-none absolute inset-y-0 z-20", allClosed && "opacity-40", isDraggingThis && "opacity-30")}
                                                    style={{ left }}
                                                >
                                                    <div
                                                        className={cn(
                                                            "absolute inset-y-0 -translate-x-1/2",
                                                            allGhost ? "w-0 border-l border-dashed border-slate-600" : "w-px bg-slate-500/70",
                                                            isLinked && !allGhost && "bg-white/80 shadow-[0_0_8px_rgba(255,255,255,0.6)]"
                                                        )}
                                                    />
                                                    <button
                                                        type="button"
                                                        data-pin-chip
                                                        className={cn(
                                                            "pointer-events-auto absolute bottom-1 left-1 flex max-w-40 items-center gap-1.5 rounded bg-slate-950 px-1.5 py-0.5 text-[11px] leading-tight transition-colors hover:text-white",
                                                            allGhost ? "text-slate-500" : "text-slate-300",
                                                            single && single.lockReason === null ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                                                            isLinked && "text-white"
                                                        )}
                                                        title={single ? `${single.title} — due ${format(single.deadlineMs, "HH:mm")}${single.lockReason ? ` (${single.lockReason})` : " · drag to postpone"}` : `${items.length} tasks due`}
                                                        onPointerDown={onPinChipPointerDown(group, items)}
                                                        onClick={(event) => togglePinPopover(group.key, event.currentTarget)}
                                                        onPointerEnter={() => single && onHoverKey(single.key)}
                                                        onPointerLeave={() => single && onHoverKey(null)}
                                                    >
                                                        {single ? (
                                                            <>
                                                                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDotClass(single.status))} />
                                                                {single.isGhost && <Repeat className="h-2.5 w-2.5 shrink-0" />}
                                                                <span className="truncate">{single.title}</span>
                                                                {single.lockReason !== null && !single.isGhost && <Lock className="h-2.5 w-2.5 shrink-0 text-slate-500" />}
                                                            </>
                                                        ) : (
                                                            <>
                                                                <span className="flex shrink-0 -space-x-0.5">
                                                                    {items.slice(0, 3).map((item) => (
                                                                        <span key={item.key} className={cn("h-1.5 w-1.5 rounded-full ring-1 ring-slate-950", statusDotClass(item.status))} />
                                                                    ))}
                                                                </span>
                                                                <span className="truncate">{items.length} due</span>
                                                            </>
                                                        )}
                                                    </button>
                                                </div>
                                            );
                                        })}

                                        {/* Pin drag preview */}
                                        {pinPreview && drag?.kind === "pin" && drag.dayIndex === dayIndex && pinPreview.item && (
                                            <div
                                                className="pointer-events-none absolute inset-y-0 z-30"
                                                style={{ left: (minutesIntoDay(new Date(pinPreview.targetMs)) / 60) * HOUR_PX }}
                                            >
                                                <div
                                                    className={cn("absolute inset-y-0 w-px -translate-x-1/2", pinPreview.error ? "bg-red-500" : "bg-white")}
                                                    style={pinPreview.error ? undefined : { boxShadow: "0 0 8px rgba(255, 255, 255, 0.7)" }}
                                                />
                                                <div
                                                    className={cn(
                                                        "absolute top-1 left-1 whitespace-nowrap rounded bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] leading-tight",
                                                        pinPreview.error ? "text-red-300" : "text-white"
                                                    )}
                                                >
                                                    {pinPreview.error ?? `Postpone to ${format(pinPreview.targetMs, "EEE HH:mm")}`}
                                                </div>
                                            </div>
                                        )}

                                        {/* Now line */}
                                        {isToday && (
                                            <div
                                                className="pointer-events-none absolute inset-y-0 z-30"
                                                style={{ left: (minutesIntoDay(now) / 60) * HOUR_PX }}
                                            >
                                                <div className="absolute inset-y-0 w-px -translate-x-1/2 bg-red-500/90" style={{ boxShadow: "0 0 6px rgba(239, 68, 68, 0.7)" }} />
                                                <div className="absolute -top-[3px] h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-red-500" />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* Pin popover: lists every task due in that 15-minute cell */}
            {pinPopover && popoverGroup && (
                <div
                    ref={popoverRef}
                    className="fixed z-[60] w-72 rounded-lg border border-slate-800 bg-slate-900 p-1.5 shadow-xl shadow-black/60"
                    style={{
                        top: Math.min(pinPopover.rect.bottom + 6, window.innerHeight - 260),
                        left: Math.max(8, Math.min(pinPopover.rect.right - 288, window.innerWidth - 296)),
                    }}
                >
                    <div className="px-2 pb-1 pt-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                        Due {format(new Date(popoverGroup.group.anchorIso), "EEE dd/MM HH:mm")}
                    </div>
                    <div className="flex max-h-60 flex-col overflow-y-auto">
                        {popoverGroup.items.map((item) => (
                            <div
                                key={item.key}
                                className={cn("group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-800/70", !item.open && "opacity-50")}
                                onPointerEnter={() => onHoverKey(item.key)}
                                onPointerLeave={() => onHoverKey(null)}
                            >
                                {item.lockReason === null ? (
                                    <span
                                        className="cursor-grab text-slate-500 hover:text-slate-200 active:cursor-grabbing"
                                        title="Drag to postpone"
                                        onPointerDown={(event) => startPinDrag(item, event)}
                                    >
                                        <GripVertical className="h-3.5 w-3.5" />
                                    </span>
                                ) : (
                                    <span className="text-slate-600" title={item.lockReason}>
                                        {item.isGhost ? <Repeat className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                                    </span>
                                )}
                                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDotClass(item.status))} />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm text-slate-100">{item.title}</div>
                                    <div className="truncate font-mono text-[10px] text-slate-500">
                                        {format(item.deadlineMs, "HH:mm")} · {item.isGhost ? "upcoming repeat" : item.status.replace(/_/g, " ").toLowerCase()}
                                        {item.lockReason && !item.isGhost ? ` · ${item.lockReason.toLowerCase()}` : ""}
                                    </div>
                                </div>
                                {item.task && (
                                    <Link href={`/tasks/${item.key}`} className="shrink-0 text-slate-500 hover:text-white" aria-label={`Open ${item.title}`}>
                                        <ExternalLink className="h-3.5 w-3.5" />
                                    </Link>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
