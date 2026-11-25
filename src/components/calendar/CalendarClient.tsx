"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight, ExternalLink, Repeat, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { createTimeBlock, deleteTimeBlock, getCalendarWeek, updateTimeBlock } from "@/actions/calendar";
import { postponeTask } from "@/actions/tasks";
import { addLocalDays, dateAtSlot, localDayKey, startOfWeekMonday } from "@/lib/calendar/grid";
import { countBlocksPastDeadline } from "@/lib/calendar/pins";
import type { BlockTarget, CalendarBlock, CalendarWeekData } from "@/lib/calendar/types";
import { subscribeRealtimeTaskChanges } from "@/lib/realtime-task-events";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { BlockTaskPicker } from "./BlockTaskPicker";
import { blockItemKey, buildWeekModel, type CalendarItem } from "./model";
import { statusDotClass } from "./tints";
import { WeekGrid, type SlotSelection } from "./WeekGrid";

const RELOAD_DEBOUNCE_MS = 400;
const NOW_TICK_MS = 30_000;

interface PickerState {
    selection: SlotSelection;
    anchor: DOMRect;
    startMs: number;
    endMs: number;
}

interface BlockPopoverState {
    blockId: string;
    anchor: DOMRect;
}

interface PostponeState {
    item: CalendarItem;
    newDeadlineMs: number;
    blocksRemoved: number;
}

function formatWeekRange(weekStart: Date): string {
    const weekEnd = addLocalDays(weekStart, 6);
    if (weekStart.getMonth() === weekEnd.getMonth()) {
        return `${format(weekStart, "d")}–${format(weekEnd, "d MMM yyyy")}`;
    }
    if (weekStart.getFullYear() === weekEnd.getFullYear()) {
        return `${format(weekStart, "d MMM")} – ${format(weekEnd, "d MMM yyyy")}`;
    }
    return `${format(weekStart, "d MMM yyyy")} – ${format(weekEnd, "d MMM yyyy")}`;
}

let tempBlockCounter = 0;

export function CalendarClient({ userId, initial }: { userId: string; initial?: { weekStartIso: string; data: CalendarWeekData } }) {
    const [weekStart, setWeekStart] = useState<Date | null>(null);
    const [now, setNow] = useState<Date | null>(null);
    const [data, setData] = useState<CalendarWeekData | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [hoveredKey, setHoveredKey] = useState<string | null>(null);
    const [picker, setPicker] = useState<PickerState | null>(null);
    const [blockPopover, setBlockPopover] = useState<BlockPopoverState | null>(null);
    const [postpone, setPostpone] = useState<PostponeState | null>(null);
    const [postponing, setPostponing] = useState(false);

    const requestIdRef = useRef(0);
    const dragActiveRef = useRef(false);
    const pendingMutationsRef = useRef(0);
    const reloadQueuedRef = useRef(false);
    const reloadTimerRef = useRef<number | null>(null);
    const blockPopoverRef = useRef<HTMLDivElement>(null);
    const weekStartRef = useRef<Date | null>(null);
    weekStartRef.current = weekStart;
    const initialRef = useRef(initial);

    useEffect(() => {
        const current = new Date();
        setNow(current);
        setWeekStart(startOfWeekMonday(current));
        const timer = window.setInterval(() => setNow(new Date()), NOW_TICK_MS);
        return () => window.clearInterval(timer);
    }, []);

    const load = useCallback(async (options: { silent?: boolean } = {}) => {
        const start = weekStartRef.current;
        if (!start) return;
        const requestId = ++requestIdRef.current;
        if (!options.silent) setLoading(true);
        const result = await getCalendarWeek(start.toISOString(), addLocalDays(start, 7).toISOString());
        if (requestId !== requestIdRef.current) return;
        if (pendingMutationsRef.current > 0 || dragActiveRef.current) {
            reloadQueuedRef.current = true;
            setLoading(false);
            return;
        }
        setLoading(false);
        if (result.error || !result.data) {
            setLoadError(result.error || "Could not load calendar.");
            return;
        }
        setLoadError(null);
        setData(result.data);
        setNow(new Date());
    }, []);

    const scheduleReload = useCallback(() => {
        if (reloadTimerRef.current !== null) window.clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = window.setTimeout(() => {
            reloadTimerRef.current = null;
            if (dragActiveRef.current || pendingMutationsRef.current > 0) {
                reloadQueuedRef.current = true;
                return;
            }
            void load({ silent: true });
        }, RELOAD_DEBOUNCE_MS);
    }, []);

    const flushQueuedReload = useCallback(() => {
        if (reloadQueuedRef.current && !dragActiveRef.current && pendingMutationsRef.current === 0) {
            reloadQueuedRef.current = false;
            scheduleReload();
        }
    }, [scheduleReload]);

    useEffect(() => {
        if (!weekStart) return;
        setPicker(null);
        setBlockPopover(null);
        const seed = initialRef.current;
        initialRef.current = undefined;
        if (seed && seed.weekStartIso === weekStart.toISOString()) {
            setData(seed.data);
            return;
        }
        setData(null);
        void load();
    }, [load, weekStart]);

    useEffect(() => subscribeRealtimeTaskChanges(() => scheduleReload()), [scheduleReload]);
    useEffect(() => {
        if (!userId) return;
        const supabase = createClient();
        const channel = supabase
            .channel(`calendar-blocks:${userId}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "task_time_blocks", filter: `user_id=eq.${userId}` }, () => scheduleReload())
            .subscribe();
        return () => {
            void supabase.removeChannel(channel);
        };
    }, [scheduleReload, userId]);

    useEffect(() => {
        const onFocus = () => scheduleReload();
        window.addEventListener("focus", onFocus);
        return () => window.removeEventListener("focus", onFocus);
    }, [scheduleReload]);

    const model = useMemo(
        () => (data && weekStart && now ? buildWeekModel(data, weekStart, now) : null),
        [data, now, weekStart]
    );

    const runMutation = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
        pendingMutationsRef.current += 1;
        try {
            return await operation();
        } finally {
            pendingMutationsRef.current -= 1;
            if (pendingMutationsRef.current === 0) {
                reloadQueuedRef.current = false;
                scheduleReload();
            }
        }
    }, [scheduleReload]);

    const replaceBlocks = useCallback((updater: (blocks: CalendarBlock[]) => CalendarBlock[]) => {
        setData((current) => (current ? { ...current, blocks: updater(current.blocks) } : current));
    }, []);

    const handleCreateSelection = useCallback((selection: SlotSelection, anchor: DOMRect) => {
        const start = weekStartRef.current;
        if (!start) return;
        const day = addLocalDays(start, selection.dayIndex);
        setBlockPopover(null);
        setPicker({
            selection,
            anchor,
            startMs: dateAtSlot(day, selection.startSlot).getTime(),
            endMs: dateAtSlot(day, selection.endSlot).getTime(),
        });
    }, []);

    const handlePick = useCallback(async (item: CalendarItem) => {
        if (!picker) return;
        const { startMs, endMs } = picker;
        setPicker(null);
        const target: BlockTarget = item.ghost
            ? { kind: "ghost", ruleId: item.ghost.ruleId, occurrenceDeadlineIso: item.ghost.deadlineIso }
            : { kind: "task", taskId: item.key };
        const tempId = `temp-${++tempBlockCounter}`;
        const optimistic: CalendarBlock = {
            id: tempId,
            task_id: item.ghost ? null : item.key,
            recurrence_rule_id: item.ghost ? item.ghost.ruleId : null,
            occurrence_deadline: item.ghost ? item.ghost.deadlineIso : null,
            start_at: new Date(startMs).toISOString(),
            end_at: new Date(endMs).toISOString(),
        };
        replaceBlocks((blocks) => [...blocks, optimistic]);
        const result = await runMutation(() => createTimeBlock(target, optimistic.start_at, optimistic.end_at));
        if (result.error || !result.block) {
            replaceBlocks((blocks) => blocks.filter((block) => block.id !== tempId));
            toast.error(result.error || "Could not create block.");
            return;
        }
        const saved = result.block;
        replaceBlocks((blocks) => blocks.map((block) => (block.id === tempId ? saved : block)));
    }, [picker, replaceBlocks, runMutation]);

    const handleBlockCommit = useCallback(async (blockId: string, startMs: number, endMs: number) => {
        if (blockId.startsWith("temp-")) return;
        let previous: CalendarBlock | undefined;
        replaceBlocks((blocks) => blocks.map((block) => {
            if (block.id !== blockId) return block;
            previous = block;
            return { ...block, start_at: new Date(startMs).toISOString(), end_at: new Date(endMs).toISOString() };
        }));
        const result = await runMutation(() => updateTimeBlock(blockId, new Date(startMs).toISOString(), new Date(endMs).toISOString()));
        if (result.error) {
            if (previous) {
                const restore = previous;
                replaceBlocks((blocks) => blocks.map((block) => (block.id === blockId ? restore : block)));
            }
            toast.error(result.error);
        }
    }, [replaceBlocks, runMutation]);

    const handleDeleteBlock = useCallback(async (blockId: string) => {
        setBlockPopover(null);
        if (blockId.startsWith("temp-")) return;
        let removed: CalendarBlock | undefined;
        replaceBlocks((blocks) => blocks.filter((block) => {
            if (block.id === blockId) removed = block;
            return block.id !== blockId;
        }));
        const result = await runMutation(() => deleteTimeBlock(blockId));
        if (result.error) {
            if (removed) {
                const restore = removed;
                replaceBlocks((blocks) => [...blocks, restore]);
            }
            toast.error(result.error);
        }
    }, [replaceBlocks, runMutation]);

    useEffect(() => {
        if (!blockPopover) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setBlockPopover(null);
            if ((event.key === "Delete" || event.key === "Backspace") && !(event.target instanceof HTMLInputElement)) {
                event.preventDefault();
                void handleDeleteBlock(blockPopover.blockId);
            }
        };
        const onDown = (event: PointerEvent) => {
            if (blockPopoverRef.current?.contains(event.target as Node)) return;
            setBlockPopover(null);
        };
        window.addEventListener("keydown", onKey);
        window.addEventListener("pointerdown", onDown);
        return () => {
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("pointerdown", onDown);
        };
    }, [blockPopover, handleDeleteBlock]);

    const handlePinDrop = useCallback((itemKey: string, newDeadlineMs: number) => {
        const item = model?.itemsByKey.get(itemKey);
        if (!item?.task || !model) return;
        if (item.lockReason) {
            toast.error(item.lockReason);
            return;
        }
        const ownBlocks = model.blocks.filter((block) => block.task_id === item.key);
        setPostpone({ item, newDeadlineMs, blocksRemoved: countBlocksPastDeadline(ownBlocks, newDeadlineMs) });
    }, [model]);

    const confirmPostpone = useCallback(async () => {
        if (!postpone) return;
        setPostponing(true);
        const result = await runMutation(() => postponeTask(postpone.item.key, new Date(postpone.newDeadlineMs).toISOString()));
        setPostponing(false);
        if (result && "error" in result && result.error) {
            toast.error(result.error);
            return;
        }
        toast.success(`Postponed to ${format(postpone.newDeadlineMs, "EEE dd/MM HH:mm")}`);
        setPostpone(null);
    }, [postpone, runMutation]);

    const handleDragActiveChange = useCallback((active: boolean) => {
        dragActiveRef.current = active;
        if (active) {
            setPicker(null);
            setBlockPopover(null);
        } else {
            flushQueuedReload();
        }
    }, [flushQueuedReload]);

    const handleBlockClick = useCallback((blockId: string, anchor: DOMRect) => {
        setPicker(null);
        setBlockPopover((current) => (current?.blockId === blockId ? null : { blockId, anchor }));
    }, []);

    const handleInvalidDrop = useCallback((message: string) => toast.error(message), []);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
            if (picker || postpone || dragActiveRef.current) return;
            if (event.key === "ArrowLeft") setWeekStart((current) => (current ? addLocalDays(current, -7) : current));
            if (event.key === "ArrowRight") setWeekStart((current) => (current ? addLocalDays(current, 7) : current));
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [picker, postpone]);

    if (!weekStart || !now) {
        return <div className="h-[calc(100dvh-8rem)] animate-pulse rounded-lg bg-slate-900/60" />;
    }

    const isCurrentWeek = localDayKey(startOfWeekMonday(now)) === localDayKey(weekStart);
    const popoverBlock = blockPopover && model ? model.blocks.find((block) => block.id === blockPopover.blockId) : null;
    const popoverItem = popoverBlock && model ? model.itemsByKey.get(blockItemKey(popoverBlock)) : null;

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-1 px-1">
                <button
                    type="button"
                    aria-label="Previous week"
                    onClick={() => setWeekStart(addLocalDays(weekStart, -7))}
                    className="flex h-9 w-9 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800 hover:text-white"
                >
                    <ChevronLeft className="h-[18px] w-[18px]" />
                </button>
                <button
                    type="button"
                    aria-label="Next week"
                    onClick={() => setWeekStart(addLocalDays(weekStart, 7))}
                    className="flex h-9 w-9 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800 hover:text-white"
                >
                    <ChevronRight className="h-[18px] w-[18px]" />
                </button>
                <h1 className="ml-2 text-lg font-medium text-white">{formatWeekRange(weekStart)}</h1>
                {!isCurrentWeek && (
                    <button
                        type="button"
                        onClick={() => setWeekStart(startOfWeekMonday(new Date()))}
                        className="ml-3 font-mono text-xs uppercase tracking-[0.12em] text-slate-400 hover:text-white"
                    >
                        Today
                    </button>
                )}
                {loading && <span className="ml-3 font-mono text-[10px] uppercase tracking-wider text-slate-600">Loading…</span>}
            </div>

            {loadError && !model ? (
                <div className="rounded-lg border border-slate-900 py-16 text-center">
                    <p className="text-base text-red-400">{loadError}</p>
                    <button type="button" className="mt-3 text-sm text-slate-300 hover:text-white" onClick={() => void load()}>
                        Retry
                    </button>
                </div>
            ) : model ? (
                <WeekGrid
                    weekStart={weekStart}
                    now={now}
                    model={model}
                    hoveredKey={hoveredKey}
                    onHoverKey={setHoveredKey}
                    selectedBlockId={blockPopover?.blockId ?? null}
                    pendingSelection={picker?.selection ?? null}
                    onCreateSelection={handleCreateSelection}
                    onBlockCommit={handleBlockCommit}
                    onBlockClick={handleBlockClick}
                    onPinDrop={handlePinDrop}
                    onDragActiveChange={handleDragActiveChange}
                    onInvalidDrop={handleInvalidDrop}
                />
            ) : (
                <div className="h-[calc(100dvh-12rem)] min-h-[480px] animate-pulse rounded-lg bg-slate-900/60" />
            )}

            {picker && model && (
                <BlockTaskPicker
                    anchor={picker.anchor}
                    startMs={picker.startMs}
                    endMs={picker.endMs}
                    items={model.plannable}
                    onPick={(item) => void handlePick(item)}
                    onClose={() => setPicker(null)}
                />
            )}

            {blockPopover && popoverBlock && popoverItem && (
                <div
                    ref={blockPopoverRef}
                    className="fixed z-[60] w-64 rounded-lg border border-slate-800 bg-slate-900 p-3 shadow-xl shadow-black/60"
                    style={{
                        top: Math.max(64, Math.min(blockPopover.anchor.top, window.innerHeight - 170)),
                        left: blockPopover.anchor.right + 8 + 256 < window.innerWidth
                            ? blockPopover.anchor.right + 8
                            : Math.max(8, blockPopover.anchor.left - 8 - 256),
                    }}
                >
                    <div className="flex items-start gap-2">
                        <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", statusDotClass(popoverItem.status))} />
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-white">{popoverItem.title}</div>
                            <div className="font-mono text-[11px] text-slate-400">
                                {format(Date.parse(popoverBlock.start_at), "EEE dd/MM HH:mm")}–{format(Date.parse(popoverBlock.end_at), "HH:mm")}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-slate-500">
                                {popoverItem.isGhost && <Repeat className="h-2.5 w-2.5" />}
                                Due {format(popoverItem.deadlineMs, "EEE dd/MM HH:mm")}
                                {!popoverItem.open && ` · ${popoverItem.status.replace(/_/g, " ").toLowerCase()}`}
                            </div>
                        </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                        {popoverItem.task ? (
                            <Link href={`/tasks/${popoverItem.key}`} className="flex items-center gap-1 text-xs text-slate-300 hover:text-white">
                                <ExternalLink className="h-3.5 w-3.5" /> Open task
                            </Link>
                        ) : (
                            <span className="text-xs text-slate-500">Upcoming repeat</span>
                        )}
                        <button
                            type="button"
                            onClick={() => void handleDeleteBlock(popoverBlock.id)}
                            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 hover:text-red-200"
                        >
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                    </div>
                </div>
            )}

            <Dialog open={Boolean(postpone)} onOpenChange={(open) => { if (!open && !postponing) setPostpone(null); }}>
                <DialogContent
                    showCloseButton={!postponing}
                    className="bg-slate-900 border-slate-800 text-slate-200 [&>[data-slot='dialog-close']]:text-slate-300 [&>[data-slot='dialog-close']]:opacity-100 [&>[data-slot='dialog-close']]:hover:text-white"
                >
                    {postpone && (
                        <>
                            <DialogHeader>
                                <DialogTitle className="text-white">Postpone deadline?</DialogTitle>
                                <DialogDescription className="text-slate-400">
                                    You can only postpone a task once. After this, its deadline is locked.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-2">
                                <p className="truncate text-base font-medium text-white">{postpone.item.title}</p>
                                <div className="flex items-center gap-2 font-mono text-sm">
                                    <span className="text-slate-400 line-through">{format(postpone.item.deadlineMs, "EEE dd/MM HH:mm")}</span>
                                    <span className="text-slate-500">→</span>
                                    <span className="text-amber-300">{format(postpone.newDeadlineMs, "EEE dd/MM HH:mm")}</span>
                                </div>
                                {postpone.blocksRemoved > 0 && (
                                    <p className="text-xs text-red-300">
                                        {postpone.blocksRemoved} block{postpone.blocksRemoved === 1 ? "" : "s"} after the new deadline will be removed.
                                    </p>
                                )}
                            </div>
                            <DialogFooter>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setPostpone(null)}
                                    disabled={postponing}
                                    className="h-9 bg-slate-800/80 border-slate-600 text-slate-100 hover:bg-slate-700/80 disabled:opacity-100 disabled:border-slate-800 disabled:bg-slate-900/50 disabled:text-slate-500"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="button"
                                    onClick={() => void confirmPostpone()}
                                    disabled={postponing}
                                    className="h-9 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300 disabled:opacity-100 disabled:border-slate-800 disabled:bg-slate-900/50 disabled:text-slate-500"
                                >
                                    {postponing ? "Postponing..." : "Postpone"}
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
