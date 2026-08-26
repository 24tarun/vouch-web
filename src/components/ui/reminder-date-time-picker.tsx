"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
    addDays,
    addMonths,
    endOfMonth,
    endOfWeek,
    format,
    isSameDay,
    isSameMonth,
    isToday,
    startOfMonth,
    startOfWeek,
    subMonths,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { CustomTimePicker } from "@/components/ui/custom-time-picker";
import {
    combineDateAndTime,
    fromDateTimeLocalValue,
    getDatePartFromLocalDateTime,
    getTimePartFromLocalDateTime,
} from "@/lib/datetime-local";
import { cn } from "@/lib/utils";

function formatDatePart(date: Date): string {
    return format(date, "yyyy-MM-dd");
}

function getCalendarDays(month: Date): Date[] {
    const days: Date[] = [];
    let day = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    while (day <= end) {
        days.push(day);
        day = addDays(day, 1);
    }
    return days;
}

const WEEKDAY_HEADERS = ["M", "T", "W", "T", "F", "S", "S"];

interface ReminderLineProps {
    at: Date;
    status: "scheduled" | "sent";
    urgent: boolean;
    onToggleUrgent: () => void;
    onDelete: () => void;
    disabled?: boolean;
    /** Alarm-style delivery is only offered when the profile has it switched on. */
    showAlarm?: boolean;
}

/** One reminder as a single row: time · date · alarm · status · delete. */
export function ReminderLine({
    at,
    status,
    urgent,
    onToggleUrgent,
    onDelete,
    disabled = false,
    showAlarm = true,
}: ReminderLineProps) {
    return (
        <div className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1 text-sm transition-colors hover:bg-slate-800/40">
            <span className="w-[46px] shrink-0 font-semibold tabular-nums text-slate-100">
                {format(at, "HH:mm")}
            </span>
            <span className="w-[86px] shrink-0 tabular-nums text-slate-400">{format(at, "dd/MM/yyyy")}</span>
            {showAlarm && (
                <button
                    type="button"
                    onClick={onToggleUrgent}
                    disabled={disabled}
                    aria-pressed={urgent}
                    aria-label={`${urgent ? "Disable" : "Enable"} alarm for reminder ${format(at, "HH:mm dd/MM/yyyy")}`}
                    title={urgent ? "Alarm-style notification on" : "Ring as an alarm on mobile"}
                    className={cn(
                        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors disabled:opacity-40",
                        urgent
                            ? "border-red-400/50 bg-red-500/20 text-red-200 hover:bg-red-500/30"
                            : "border-slate-600/70 bg-slate-700/40 text-slate-300 hover:border-red-400/50 hover:bg-red-500/15 hover:text-red-200"
                    )}
                >
                    Alarm
                </button>
            )}
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
                <span
                    aria-hidden="true"
                    className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        status === "scheduled" ? "bg-emerald-400/70" : "bg-slate-600"
                    )}
                />
                {status}
            </span>
            <span className="flex-1" />
            <button
                type="button"
                onClick={onDelete}
                disabled={disabled}
                aria-label={`Delete reminder ${format(at, "HH:mm dd/MM/yyyy")}`}
                className="shrink-0 rounded-md border border-slate-600/70 bg-slate-700/40 p-1.5 text-slate-300 transition-colors hover:border-red-400/50 hover:bg-red-500/15 hover:text-red-200 disabled:opacity-40"
            >
                <Trash2 className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}

interface ReminderDateTimePickerProps {
    value: string;
    onChange: (value: string) => void;
    onAdd?: () => void;
    onRemove?: () => void;
    disabled?: boolean;
    addDisabled?: boolean;
}

export function ReminderDateTimePicker({
    value,
    onChange,
    onAdd,
    onRemove,
    disabled = false,
    addDisabled = false,
}: ReminderDateTimePickerProps) {
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const calendarRef = useRef<HTMLDivElement>(null);

    const selectedDate = fromDateTimeLocalValue(value);
    const selectedDatePart = getDatePartFromLocalDateTime(value);
    const selectedTimePart = getTimePartFromLocalDateTime(value);
    const currentMonth = startOfMonth(new Date());
    const [visibleMonth, setVisibleMonth] = useState(
        selectedDate ? startOfMonth(selectedDate) : currentMonth
    );
    const canGoToPreviousMonth = visibleMonth.getTime() > currentMonth.getTime();

    const calendarDays = useMemo(() => getCalendarDays(visibleMonth), [visibleMonth]);

    useEffect(() => {
        if (!isCalendarOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
                setIsCalendarOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isCalendarOpen]);

    const commitDatePart = (datePart: string) => {
        onChange(combineDateAndTime(datePart, selectedTimePart || "12:00"));
        const next = new Date(datePart);
        if (!Number.isNaN(next.getTime())) {
            setVisibleMonth(startOfMonth(next));
        }
    };

    const commitTime = (time: string) => {
        if (!time) return;
        onChange(combineDateAndTime(selectedDatePart || formatDatePart(new Date()), time));
    };

    const canAdd = Boolean(onAdd) && !addDisabled && Boolean(value);

    return (
        <div className={cn("flex items-center gap-2", disabled && "pointer-events-none opacity-40")}>
            <div ref={calendarRef} className="relative w-[150px] shrink-0">
                <button
                    type="button"
                    onClick={() => setIsCalendarOpen((open) => !open)}
                    disabled={disabled}
                    className={cn(
                        "flex h-9 w-full items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/60 px-2.5 text-left text-sm transition-colors hover:border-slate-600",
                        isCalendarOpen && "border-amber-400/60",
                        selectedDate ? "text-slate-100" : "text-slate-500"
                    )}
                >
                    <CalendarDays className="h-4 w-4 shrink-0 text-amber-400/70" />
                    <span>{selectedDate ? format(selectedDate, "EEE d MMM") : "Date"}</span>
                </button>

                {isCalendarOpen && (
                    <div className="absolute left-0 top-full z-50 mt-1.5 w-[268px] rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl shadow-black/50">
                        <div className="mb-1 flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-200">
                                {format(visibleMonth, "MMMM yyyy")}
                            </span>
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    aria-label="Previous month"
                                    className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-30"
                                    disabled={!canGoToPreviousMonth}
                                    onClick={() => {
                                        if (!canGoToPreviousMonth) return;
                                        setVisibleMonth((c) => {
                                            const prev = subMonths(c, 1);
                                            return prev.getTime() < currentMonth.getTime() ? currentMonth : prev;
                                        });
                                    }}
                                >
                                    <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
                                </button>
                                <button
                                    type="button"
                                    aria-label="Next month"
                                    className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
                                    onClick={() => setVisibleMonth((c) => addMonths(c, 1))}
                                >
                                    <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-7 text-center">
                            {WEEKDAY_HEADERS.map((d, i) => (
                                <div key={`${d}-${i}`} className="pb-1 text-[9px] font-semibold uppercase text-slate-600">
                                    {d}
                                </div>
                            ))}
                        </div>

                        <div className="grid grid-cols-7">
                            {calendarDays.map((day) => {
                                const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
                                if (!isSameMonth(day, visibleMonth)) {
                                    return <div key={day.toISOString()} className="h-8" />;
                                }
                                return (
                                    <button
                                        key={day.toISOString()}
                                        type="button"
                                        onClick={() => {
                                            commitDatePart(formatDatePart(day));
                                            setIsCalendarOpen(false);
                                        }}
                                        className="flex h-8 items-center justify-center"
                                    >
                                        <span
                                            className={cn(
                                                "flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition-colors",
                                                isSelected
                                                    ? "bg-amber-500 font-bold text-slate-950"
                                                    : "text-slate-300 hover:bg-slate-800 hover:text-white",
                                                isToday(day) && !isSelected && "text-amber-300"
                                            )}
                                        >
                                            {format(day, "d")}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            <CustomTimePicker
                ariaLabel="Reminder time"
                className="shrink-0"
                value={selectedTimePart}
                placeholder="--:--"
                onChange={commitTime}
                onSubmit={canAdd ? onAdd : undefined}
                compact
            />

            {onAdd && (
                <button
                    type="button"
                    onClick={onAdd}
                    disabled={!canAdd}
                    aria-label="Add reminder"
                    title="Add reminder"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-slate-950 transition-colors hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-600"
                >
                    <Plus className="h-4 w-4" strokeWidth={3} />
                </button>
            )}

            {onRemove && (
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label="Delete reminder"
                    title="Delete reminder"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-800 text-slate-500 transition-colors hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400"
                >
                    <Trash2 className="h-4 w-4" />
                </button>
            )}
        </div>
    );
}
