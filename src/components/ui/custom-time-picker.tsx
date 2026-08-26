"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface CustomTimePickerProps {
    value: string;
    placeholder?: string;
    onChange: (value: string) => void;
    onSubmit?: () => void;
    className?: string;
    compact?: boolean;
    ariaLabel?: string;
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

export function shiftClockTime(hour: number, minute: number, delta: number): string {
    const totalMinutes = ((hour * 60 + minute + delta) % 1440 + 1440) % 1440;
    const nextHour = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const nextMinute = String(totalMinutes % 60).padStart(2, "0");
    return `${nextHour}:${nextMinute}`;
}

/** Turns loose keyboard input ("9", "930", "9:3", "1830") into "HH:MM", or "" when unparseable. */
export function parseTimeInput(raw: string): string {
    const digits = raw.replace(/\D/g, "").slice(0, 4);
    if (!digits) return "";

    let hour: number;
    let minute: number;
    if (digits.length <= 2) {
        const asNumber = Number.parseInt(digits, 10);
        if (asNumber <= 23) {
            hour = asNumber;
            minute = 0;
        } else {
            hour = Number.parseInt(digits[0], 10);
            minute = Number.parseInt(digits[1], 10) * 10;
        }
    } else {
        hour = Number.parseInt(digits.slice(0, digits.length - 2), 10);
        minute = Number.parseInt(digits.slice(-2), 10);
    }

    return `${String(Math.min(hour, 23)).padStart(2, "0")}:${String(Math.min(minute, 59)).padStart(2, "0")}`;
}

function ScrollColumn({
    items,
    selected,
    onSelect,
    label,
}: {
    items: string[];
    selected: string;
    onSelect: (value: string) => void;
    label: string;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const selectedRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (selectedRef.current && containerRef.current) {
            const container = containerRef.current;
            const el = selectedRef.current;
            const top = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
            container.scrollTo({ top, behavior: "instant" });
        }
    }, [selected]);

    return (
        <div
            ref={containerRef}
            aria-label={label}
            className="h-[200px] w-[58px] overflow-y-auto overscroll-contain scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-transparent"
        >
            <div className="py-[80px]">
                {items.map((item) => {
                    const isSelected = item === selected;
                    return (
                        <button
                            key={item}
                            ref={isSelected ? selectedRef : undefined}
                            type="button"
                            onClick={() => onSelect(item)}
                            className={cn(
                                "flex h-9 w-full items-center justify-center rounded-md text-sm tabular-nums transition-colors",
                                isSelected
                                    ? "bg-amber-500/20 font-semibold text-amber-200"
                                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                            )}
                        >
                            {item}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export function CustomTimePicker({
    value,
    placeholder = "--:--",
    onChange,
    onSubmit,
    className,
    compact = false,
    ariaLabel = "Time",
}: CustomTimePickerProps) {
    const [draft, setDraft] = useState<string | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const wheelDeltaRef = useRef(0);

    const [hour, minute] = value ? value.split(":") : ["", ""];

    const shiftBy = useCallback((delta: number) => {
        const source = parseTimeInput(draft ?? value) || value;
        const now = new Date();
        const [h, m] = source ? source.split(":") : [String(now.getHours()), String(now.getMinutes())];
        setDraft(null);
        onChange(shiftClockTime(Number.parseInt(h, 10), Number.parseInt(m, 10), delta));
    }, [draft, value, onChange]);

    useEffect(() => {
        const input = inputRef.current;
        if (!input) return;

        const handleWheel = (event: WheelEvent) => {
            event.preventDefault();
            event.stopPropagation();
            const deltaScale = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 100 : 1;
            wheelDeltaRef.current += event.deltaY * deltaScale;
            if (Math.abs(wheelDeltaRef.current) < 40) return;
            shiftBy(wheelDeltaRef.current > 0 ? 1 : -1);
            wheelDeltaRef.current = 0;
        };

        input.addEventListener("wheel", handleWheel, { passive: false });
        return () => input.removeEventListener("wheel", handleWheel);
    }, [shiftBy]);

    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isOpen]);

    const commitDraft = () => {
        if (draft === null) return;
        const parsed = parseTimeInput(draft);
        setDraft(null);
        if (parsed !== value) onChange(parsed);
    };

    const nudgeClassName = cn(
        "shrink-0 text-xs font-semibold tabular-nums text-slate-500 transition-colors hover:bg-slate-800 hover:text-white",
        compact ? "h-8 px-1.5" : "h-9 px-2"
    );

    return (
        <div
            ref={containerRef}
            className={cn(
                "relative inline-flex items-center rounded-lg border border-slate-700 bg-slate-950/60 transition-colors focus-within:border-amber-400/60",
                className
            )}
        >
            {[-10, -1].map((delta) => (
                <button
                    key={delta}
                    type="button"
                    onClick={() => shiftBy(delta)}
                    className={cn(nudgeClassName, delta === -10 && "rounded-l-[7px]")}
                    aria-label={`${ariaLabel} minus ${Math.abs(delta)} minute${delta === -1 ? "" : "s"}`}
                >
                    {delta}
                </button>
            ))}

            <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                aria-label={ariaLabel}
                value={draft ?? value}
                placeholder={placeholder}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={(e) => {
                    e.target.select();
                    setIsOpen(true);
                }}
                onBlur={commitDraft}
                onKeyDown={(e) => {
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                        e.preventDefault();
                        shiftBy((e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 60 : 15));
                        return;
                    }
                    if (e.key === "Enter") {
                        e.preventDefault();
                        commitDraft();
                        setIsOpen(false);
                        onSubmit?.();
                        return;
                    }
                    if (e.key === "Escape") {
                        setDraft(null);
                        setIsOpen(false);
                    }
                }}
                className={cn(
                    "min-w-0 border-x border-slate-800 bg-transparent text-center font-medium tabular-nums text-slate-100 outline-none placeholder:text-slate-600",
                    compact ? "h-8 w-[58px] text-sm" : "h-9 w-[66px] text-base"
                )}
            />

            {[1, 10].map((delta) => (
                <button
                    key={delta}
                    type="button"
                    onClick={() => shiftBy(delta)}
                    className={cn(nudgeClassName, delta === 10 && "rounded-r-[7px]")}
                    aria-label={`${ariaLabel} plus ${delta} minute${delta === 1 ? "" : "s"}`}
                >
                    +{delta}
                </button>
            ))}

            {isOpen && (
                <div
                    className={cn(
                        "absolute left-1/2 z-50 -translate-x-1/2 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl shadow-black/50",
                        // The compact variant sits at the bottom of the schedule dialog, where a
                        // downward menu would open past the scroll container's edge.
                        compact ? "bottom-full mb-1" : "top-full mt-1"
                    )}
                >
                    <div className="flex divide-x divide-slate-800">
                        <ScrollColumn
                            label={`${ariaLabel} hours`}
                            items={HOURS}
                            selected={hour || "00"}
                            onSelect={(h) => onChange(`${h}:${minute || "00"}`)}
                        />
                        <ScrollColumn
                            label={`${ariaLabel} minutes`}
                            items={MINUTES}
                            selected={minute || "00"}
                            onSelect={(m) => onChange(`${hour || "00"}:${m}`)}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
