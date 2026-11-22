"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { Repeat, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CalendarItem } from "./model";
import { statusDotClass } from "./tints";

const PICKER_WIDTH = 300;
const PICKER_MAX_HEIGHT = 340;

interface BlockTaskPickerProps {
    anchor: DOMRect;
    startMs: number;
    endMs: number;
    items: CalendarItem[];
    onPick: (item: CalendarItem) => void;
    onClose: () => void;
}

export function BlockTaskPicker({ anchor, startMs, endMs, items, onPick, onClose }: BlockTaskPickerProps) {
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    const rootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const eligible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return items
            .filter((item) => item.deadlineMs >= endMs)
            .filter((item) => !needle || item.title.toLowerCase().includes(needle));
    }, [endMs, items, query]);

    const tooLate = useMemo(() => items.filter((item) => item.deadlineMs < endMs).length, [endMs, items]);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    useEffect(() => {
        const onDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) onClose();
        };
        window.addEventListener("pointerdown", onDown);
        return () => window.removeEventListener("pointerdown", onDown);
    }, [onClose]);

    const fitsRight = anchor.right + 8 + PICKER_WIDTH < window.innerWidth;
    const left = fitsRight ? anchor.right + 8 : Math.max(8, anchor.left - 8 - PICKER_WIDTH);
    const top = Math.max(64, Math.min(anchor.top, window.innerHeight - PICKER_MAX_HEIGHT - 12));
    const clampedIndex = Math.min(activeIndex, Math.max(0, eligible.length - 1));

    return (
        <div
            ref={rootRef}
            role="dialog"
            aria-label="Choose a task for this block"
            className="fixed z-[60] flex flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900 shadow-xl shadow-black/60"
            style={{ left, top, width: PICKER_WIDTH, maxHeight: PICKER_MAX_HEIGHT }}
        >
            <div className="border-b border-slate-800 px-3 pb-2 pt-2.5">
                <div className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
                    Block {format(startMs, "EEE")} {format(startMs, "HH:mm")}–{format(endMs, "HH:mm")}
                </div>
                <div className="mt-2 flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/70 px-2">
                    <Search className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(event) => {
                            setQuery(event.target.value);
                            setActiveIndex(0);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === "Escape") {
                                event.preventDefault();
                                onClose();
                            } else if (event.key === "ArrowDown") {
                                event.preventDefault();
                                setActiveIndex(Math.min(eligible.length - 1, clampedIndex + 1));
                            } else if (event.key === "ArrowUp") {
                                event.preventDefault();
                                setActiveIndex(Math.max(0, clampedIndex - 1));
                            } else if (event.key === "Enter") {
                                event.preventDefault();
                                const item = eligible[clampedIndex];
                                if (item) onPick(item);
                            }
                        }}
                        placeholder="Which task is this for?"
                        className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
                    />
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-1">
                {eligible.length === 0 ? (
                    <p className="px-2 py-4 text-center text-sm text-slate-500">
                        {query.trim() ? "No matching tasks." : "No active tasks due after this block."}
                    </p>
                ) : (
                    eligible.map((item, index) => (
                        <button
                            key={item.key}
                            type="button"
                            onPointerEnter={() => setActiveIndex(index)}
                            onClick={() => onPick(item)}
                            className={cn(
                                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
                                index === clampedIndex ? "bg-slate-800" : "hover:bg-slate-800/60"
                            )}
                        >
                            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDotClass(item.status))} />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm text-slate-100">{item.title}</span>
                                <span className="flex items-center gap-1 font-mono text-[10px] text-slate-500">
                                    {item.isGhost && <Repeat className="h-2.5 w-2.5" />}
                                    Due {format(item.deadlineMs, "EEE dd/MM HH:mm")}
                                </span>
                            </span>
                        </button>
                    ))
                )}
            </div>
            {tooLate > 0 && (
                <div className="border-t border-slate-800 px-3 py-1.5 font-mono text-[10px] text-slate-500">
                    {tooLate} task{tooLate === 1 ? "" : "s"} hidden — due before this block ends
                </div>
            )}
        </div>
    );
}
