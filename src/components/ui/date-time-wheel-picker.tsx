"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "@/lib/datetime-local";

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

interface DateTimeWheelPickerProps {
    value: Date;
    onChange: (nextValue: Date) => void;
    className?: string;
    idPrefix?: string;
    label?: string;
    hideTrigger?: boolean;
}

interface DateTimeRangeWheelPickerProps {
    start: Date | null;
    end: Date;
    onStartChange: (nextStart: Date | null) => void;
    onEndChange: (nextEnd: Date) => void;
    className?: string;
    defaultDurationMinutes?: number;
}

interface TimeWheelColumnProps {
    idPrefix: string;
    label: string;
    value: number;
    maxValue: number;
    onChange: (nextValue: number) => void;
}

function startOfDay(date: Date): Date {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    return next;
}

function startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function addMinutes(date: Date, minutes: number): Date {
    return new Date(date.getTime() + minutes * 60 * 1000);
}

function formatMonthLabel(date: Date): string {
    return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatDateLabel(date: Date): string {
    return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function formatTimeLabel(date: Date): string {
    return date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function buildMonthGrid(anchorMonth: Date): Date[] {
    const firstOfMonth = startOfMonth(anchorMonth);
    const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
    const firstCell = new Date(firstOfMonth);
    firstCell.setDate(firstOfMonth.getDate() - mondayOffset);

    return Array.from({ length: 42 }, (_, index) => {
        const day = new Date(firstCell);
        day.setDate(firstCell.getDate() + index);
        return day;
    });
}

function TimeWheelColumn({ idPrefix, label, value, maxValue, onChange }: TimeWheelColumnProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const options = useMemo(() => Array.from({ length: maxValue + 1 }, (_, index) => index), [maxValue]);

    useEffect(() => {
        const selected = scrollRef.current?.querySelector<HTMLButtonElement>(`button[data-wheel-value="${value}"]`);
        selected?.scrollIntoView({ block: "center" });
    }, [value]);

    const stepValue = (delta: number) => {
        const next = clamp(value + delta, 0, maxValue);
        onChange(next);
    };

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key === "ArrowUp") {
            event.preventDefault();
            stepValue(-1);
            return;
        }
        if (event.key === "ArrowDown") {
            event.preventDefault();
            stepValue(1);
            return;
        }
        if (event.key === "Home") {
            event.preventDefault();
            onChange(0);
            return;
        }
        if (event.key === "End") {
            event.preventDefault();
            onChange(maxValue);
        }
    };

    return (
        <div className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
            <div
                ref={scrollRef}
                className="calendar-thin-scroll h-52 rounded-lg border border-white/10 bg-black/35 p-1.5"
                tabIndex={0}
                role="listbox"
                aria-label={label}
                onKeyDown={handleKeyDown}
            >
                {options.map((item) => (
                    <button
                        key={`${idPrefix}-${item}`}
                        type="button"
                        data-wheel-value={item}
                        onClick={() => onChange(item)}
                        className={cn(
                            "mb-1 flex h-8 w-full items-center justify-center rounded-md font-mono text-sm transition",
                            item === value
                                ? "bg-slate-700/90 text-slate-100"
                                : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
                        )}
                    >
                        {String(item).padStart(2, "0")}
                    </button>
                ))}
            </div>
        </div>
    );
}

export function DateTimeWheelPicker({
    value,
    onChange,
    className,
    idPrefix = "date-time-wheel",
    label = "Date & Time",
    hideTrigger = false,
}: DateTimeWheelPickerProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const [mode, setMode] = useState<"wheel" | "manual">("wheel");
    const [wheelPanel, setWheelPanel] = useState<"date" | "time">("date");
    const [isOpen, setIsOpen] = useState(false);
    const [monthAnchor, setMonthAnchor] = useState<Date>(() => startOfMonth(value));
    const [manualValue, setManualValue] = useState<string>(() => toDateTimeLocalValue(value));
    const [manualError, setManualError] = useState<string | null>(null);

    useEffect(() => {
        setMonthAnchor(startOfMonth(value));
        setManualValue(toDateTimeLocalValue(value));
    }, [value]);

    const monthDays = useMemo(() => buildMonthGrid(monthAnchor), [monthAnchor]);
    const today = useMemo(() => startOfDay(new Date()), []);

    const handleDateSelect = (nextDate: Date) => {
        const next = new Date(nextDate);
        next.setHours(value.getHours(), value.getMinutes(), 0, 0);
        onChange(next);
    };

    const handleHourChange = (hours: number) => {
        const next = new Date(value);
        next.setHours(hours, value.getMinutes(), 0, 0);
        onChange(next);
    };

    const handleMinuteChange = (minutes: number) => {
        const next = new Date(value);
        next.setHours(value.getHours(), minutes, 0, 0);
        onChange(next);
    };

    const openDatePanel = () => {
        if (isOpen && mode === "wheel" && wheelPanel === "date") {
            setIsOpen(false);
            return;
        }
        setMode("wheel");
        setWheelPanel("date");
        setIsOpen(true);
    };

    const openTimePanel = () => {
        if (isOpen && mode === "wheel" && wheelPanel === "time") {
            setIsOpen(false);
            return;
        }
        setMode("wheel");
        setWheelPanel("time");
        setIsOpen(true);
    };

    const handleManualChange = (nextValue: string) => {
        setManualValue(nextValue);
        const parsed = fromDateTimeLocalValue(nextValue);
        if (!parsed) {
            setManualError("Enter a valid date and time.");
            return;
        }
        setManualError(null);
        onChange(parsed);
    };

    useEffect(() => {
        if (hideTrigger || !isOpen) return;

        const handleOutsidePress = (event: MouseEvent | TouchEvent) => {
            if (!rootRef.current) return;
            if (!rootRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setIsOpen(false);
            }
        };

        document.addEventListener("mousedown", handleOutsidePress);
        document.addEventListener("touchstart", handleOutsidePress);
        document.addEventListener("keydown", handleEscape);

        return () => {
            document.removeEventListener("mousedown", handleOutsidePress);
            document.removeEventListener("touchstart", handleOutsidePress);
            document.removeEventListener("keydown", handleEscape);
        };
    }, [hideTrigger, isOpen]);

    const panel = (
        <div
            className={cn(
                "space-y-3 rounded-xl border border-white/10 bg-slate-950/95 p-3 shadow-[0_24px_48px_-26px_rgba(0,0,0,0.95)]",
                !hideTrigger && "absolute left-0 top-full z-50 mt-2 w-full max-w-[760px]"
            )}
        >
            <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                    <p className="truncate text-sm text-slate-100">
                        {formatDateLabel(value)} at {formatTimeLabel(value)}
                    </p>
                </div>

                <div className="flex items-center rounded-md border border-white/10 bg-black/25 p-0.5">
                    <button
                        type="button"
                        onClick={() => {
                            setMode("wheel");
                            setWheelPanel("date");
                        }}
                        className={cn(
                            "rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition",
                            mode === "wheel" && wheelPanel === "date" ? "bg-cyan-200 text-slate-900" : "text-slate-300 hover:bg-white/10"
                        )}
                    >
                        Date
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setMode("wheel");
                            setWheelPanel("time");
                        }}
                        className={cn(
                            "rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition",
                            mode === "wheel" && wheelPanel === "time" ? "bg-cyan-200 text-slate-900" : "text-slate-300 hover:bg-white/10"
                        )}
                    >
                        Time
                    </button>
                    <button
                        type="button"
                        onClick={() => setMode("manual")}
                        className={cn(
                            "rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition",
                            mode === "manual" ? "bg-cyan-200 text-slate-900" : "text-slate-300 hover:bg-white/10"
                        )}
                    >
                        Manual
                    </button>
                </div>

                {!hideTrigger && (
                    <button
                        type="button"
                        onClick={() => setIsOpen(false)}
                        className="rounded-md border border-white/10 bg-black/25 p-1 text-slate-300 transition hover:bg-white/10 hover:text-slate-100"
                        aria-label="Close picker"
                    >
                        <X className="h-4 w-4" />
                    </button>
                )}
            </div>

            {mode === "manual" ? (
                <div className="space-y-2">
                    <Input
                        id={`${idPrefix}-manual-input`}
                        type="datetime-local"
                        step={60}
                        value={manualValue}
                        onChange={(event) => handleManualChange(event.target.value)}
                        className="border-white/15 bg-slate-900 text-slate-100 [color-scheme:dark]"
                    />
                    {manualError && <p className="text-xs text-red-300">{manualError}</p>}
                </div>
            ) : wheelPanel === "date" ? (
                <div className="rounded-lg border border-white/10 bg-black/25 p-2">
                    <div className="mb-2 flex items-center justify-between">
                        <button
                            type="button"
                            onClick={() => setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                            className="rounded-md p-1 text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
                            aria-label="Go to previous month"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <div className="text-sm font-semibold text-slate-100">{formatMonthLabel(monthAnchor)}</div>
                        <button
                            type="button"
                            onClick={() => setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                            className="rounded-md p-1 text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
                            aria-label="Go to next month"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>

                    <div className="grid grid-cols-7 gap-1">
                        {WEEKDAY_LABELS.map((labelValue) => (
                            <div key={`${idPrefix}-weekday-${labelValue}`} className="text-center text-[10px] font-semibold text-slate-500">
                                {labelValue}
                            </div>
                        ))}
                    </div>

                    <div className="mt-1 grid grid-cols-7 gap-1">
                        {monthDays.map((day) => {
                            const inMonth = day.getMonth() === monthAnchor.getMonth();
                            const selected = isSameDay(day, value);
                            const isToday = isSameDay(day, today);
                            return (
                                <button
                                    key={`${idPrefix}-${day.toISOString()}`}
                                    type="button"
                                    onClick={() => handleDateSelect(day)}
                                    className={cn(
                                        "h-8 rounded-md text-sm transition",
                                        selected
                                            ? "bg-cyan-500/85 font-semibold text-slate-950"
                                            : "text-slate-200 hover:bg-white/10",
                                        !inMonth && !selected && "text-slate-500",
                                        isToday && !selected && "ring-1 ring-cyan-300/45"
                                    )}
                                >
                                    {day.getDate()}
                                </button>
                            );
                        })}
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-2">
                    <TimeWheelColumn
                        idPrefix={`${idPrefix}-hour`}
                        label="Hour"
                        value={value.getHours()}
                        maxValue={23}
                        onChange={handleHourChange}
                    />
                    <TimeWheelColumn
                        idPrefix={`${idPrefix}-minute`}
                        label="Minute"
                        value={value.getMinutes()}
                        maxValue={59}
                        onChange={handleMinuteChange}
                    />
                </div>
            )}
        </div>
    );

    if (hideTrigger) {
        return <div className={cn("space-y-2", className)}>{panel}</div>;
    }

    return (
        <div ref={rootRef} className={cn("relative space-y-2", className)}>
            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={openDatePanel}
                    className="min-w-[220px] rounded-md border border-white/10 bg-slate-900/70 px-3 py-2 text-left text-slate-100 transition hover:bg-slate-800"
                >
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">Date</div>
                    <div className="truncate text-sm">{formatDateLabel(value)}</div>
                </button>
                <button
                    type="button"
                    onClick={openTimePanel}
                    className="rounded-md border border-white/10 bg-slate-900/70 px-3 py-2 font-mono text-base text-slate-100 transition hover:bg-slate-800"
                >
                    {formatTimeLabel(value)}
                </button>
            </div>
            {isOpen && panel}
        </div>
    );
}

export function DateTimeRangeWheelPicker({
    start,
    end,
    onStartChange,
    onEndChange,
    className,
    defaultDurationMinutes = 60,
}: DateTimeRangeWheelPickerProps) {
    const [activeField, setActiveField] = useState<"start" | "end">("start");
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const fallbackStart = useMemo(() => addMinutes(end, -defaultDurationMinutes), [defaultDurationMinutes, end]);
    const effectiveStart = start ?? fallbackStart;
    const activeValue = activeField === "start" ? effectiveStart : end;

    const updateActiveFieldValue = (nextValue: Date) => {
        if (activeField === "start") {
            onStartChange(nextValue);
            if (end.getTime() <= nextValue.getTime()) {
                onEndChange(addMinutes(nextValue, defaultDurationMinutes));
            }
            return;
        }
        onEndChange(nextValue);
    };

    return (
        <div className={cn("space-y-3", className)}>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-slate-900/70 p-2">
                <button
                    type="button"
                    onClick={() => {
                        setActiveField("start");
                        setIsPickerOpen(true);
                    }}
                    className={cn(
                        "min-w-[190px] rounded-md border px-3 py-2 text-left transition",
                        activeField === "start"
                            ? "border-cyan-200/45 bg-cyan-200/10 text-cyan-100"
                            : "border-white/10 bg-black/25 text-slate-200 hover:bg-white/10"
                    )}
                >
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">Start date</div>
                    <div className="truncate text-sm font-medium">{formatDateLabel(effectiveStart)}</div>
                </button>

                <button
                    type="button"
                    onClick={() => {
                        setActiveField("start");
                        setIsPickerOpen(true);
                    }}
                    className={cn(
                        "rounded-md border px-3 py-2 font-mono text-base transition",
                        activeField === "start"
                            ? "border-cyan-200/45 bg-cyan-200/10 text-cyan-100"
                            : "border-white/10 bg-black/25 text-slate-200 hover:bg-white/10"
                    )}
                    aria-label="Select start time"
                >
                    {formatTimeLabel(effectiveStart)}
                </button>

                <span className="px-1 text-slate-400">-</span>

                <button
                    type="button"
                    onClick={() => {
                        setActiveField("end");
                        setIsPickerOpen(true);
                    }}
                    className={cn(
                        "rounded-md border px-3 py-2 font-mono text-base transition",
                        activeField === "end"
                            ? "border-cyan-200/45 bg-cyan-200/10 text-cyan-100"
                            : "border-white/10 bg-black/25 text-slate-200 hover:bg-white/10"
                    )}
                    aria-label="Select end time"
                >
                    {formatTimeLabel(end)}
                </button>

                <button
                    type="button"
                    onClick={() => {
                        setActiveField("end");
                        setIsPickerOpen(true);
                    }}
                    className={cn(
                        "min-w-[140px] rounded-md border px-3 py-2 text-left transition",
                        activeField === "end"
                            ? "border-cyan-200/45 bg-cyan-200/10 text-cyan-100"
                            : "border-white/10 bg-black/25 text-slate-200 hover:bg-white/10"
                    )}
                >
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">End date</div>
                    <div className="truncate text-sm font-medium">{formatDateLabel(end)}</div>
                </button>

                <button
                    type="button"
                    onClick={() => onStartChange(null)}
                    className="ml-auto inline-flex items-center gap-1 rounded-md border border-white/10 bg-black/25 px-2.5 py-2 text-xs text-slate-300 transition hover:bg-white/10 hover:text-slate-100"
                    title="Clear start"
                >
                    <X className="h-3.5 w-3.5" />
                    Clear Start
                </button>
            </div>

            {isPickerOpen && (
                <div className="space-y-2">
                    <DateTimeWheelPicker
                        value={activeValue}
                        onChange={updateActiveFieldValue}
                        idPrefix={`range-${activeField}`}
                        label={activeField === "start" ? "Start" : "End"}
                        hideTrigger
                    />
                    <div className="flex justify-end">
                        <button
                            type="button"
                            onClick={() => setIsPickerOpen(false)}
                            className="rounded-md border border-white/10 bg-black/25 px-2.5 py-1.5 text-xs text-slate-300 transition hover:bg-white/10 hover:text-slate-100"
                        >
                            Close Picker
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
