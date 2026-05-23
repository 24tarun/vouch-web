"use client";

import { useMemo, useState } from "react";
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
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
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

const WEEKDAY_HEADERS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

interface ReminderDateTimePickerProps {
    value: string;
    onChange: (value: string) => void;
    onAdd: () => void;
    disabled?: boolean;
    addDisabled?: boolean;
}

export function ReminderDateTimePicker({
    value,
    onChange,
    onAdd,
    disabled = false,
    addDisabled = false,
}: ReminderDateTimePickerProps) {
    const [isOpen, setIsOpen] = useState(false);

    const selectedDate = fromDateTimeLocalValue(value);
    const selectedDatePart = getDatePartFromLocalDateTime(value);
    const selectedTimePart = getTimePartFromLocalDateTime(value);
    const currentMonth = startOfMonth(new Date());
    const [visibleMonth, setVisibleMonth] = useState(
        selectedDate ? startOfMonth(selectedDate) : currentMonth
    );
    const canGoToPreviousMonth = visibleMonth.getTime() > currentMonth.getTime();

    const calendarDays = useMemo(() => getCalendarDays(visibleMonth), [visibleMonth]);

    const displayLabel = selectedDate
        ? `${format(selectedDate, "dd MMM yyyy")}, ${selectedTimePart || "--:--"}`
        : "Pick date & time";

    const commitDatePart = (datePart: string) => {
        const time = selectedTimePart || "12:00";
        onChange(combineDateAndTime(datePart, time));
        const next = new Date(datePart);
        if (!Number.isNaN(next.getTime())) {
            setVisibleMonth(startOfMonth(next));
        }
    };

    const commitTime = (time: string) => {
        if (!time) return;
        const date = selectedDatePart || formatDatePart(new Date());
        onChange(combineDateAndTime(date, time));
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => !disabled && setIsOpen(!isOpen)}
                    disabled={disabled}
                    className={cn(
                        "flex h-11 flex-1 items-center gap-2.5 rounded-lg border px-3 text-left transition-colors",
                        "border-slate-700 bg-slate-950/60 hover:border-slate-600",
                        isOpen && "border-amber-400/50 ring-1 ring-amber-400/20",
                        disabled && "opacity-40 cursor-not-allowed",
                        selectedDate ? "text-slate-100" : "text-slate-500"
                    )}
                >
                    <Calendar className="h-4 w-4 shrink-0 text-amber-400/70" />
                    <span className="text-sm">{displayLabel}</span>
                </button>
                <button
                    type="button"
                    onClick={() => {
                        onAdd();
                        setIsOpen(false);
                    }}
                    disabled={addDisabled}
                    className="h-11 shrink-0 rounded-lg border border-slate-700 bg-slate-950/60 px-4 text-sm text-slate-200 transition-colors hover:bg-slate-800 disabled:border-slate-800 disabled:text-slate-500 disabled:opacity-100"
                >
                    Add
                </button>
            </div>

            {isOpen && (
                <div className="rounded-lg border border-slate-700 bg-slate-900/95 p-4 space-y-4">
                    {/* Month header */}
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-slate-200">
                            {format(visibleMonth, "MMMM yyyy")}
                        </span>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                className="flex h-7 w-7 items-center justify-center text-amber-400 transition-colors hover:text-amber-300 disabled:opacity-30 disabled:text-slate-600"
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
                                className="flex h-7 w-7 items-center justify-center text-amber-400 transition-colors hover:text-amber-300"
                                onClick={() => setVisibleMonth((c) => addMonths(c, 1))}
                            >
                                <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
                            </button>
                        </div>
                    </div>

                    {/* Weekday headers */}
                    <div className="grid grid-cols-7 text-center">
                        {WEEKDAY_HEADERS.map((d) => (
                            <div key={d} className="pb-2 text-[9px] font-semibold uppercase tracking-widest text-slate-500">
                                {d}
                            </div>
                        ))}
                    </div>

                    {/* Calendar grid */}
                    <div className="grid grid-cols-7 gap-y-0.5">
                        {calendarDays.map((day) => {
                            const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
                            const isMuted = !isSameMonth(day, visibleMonth);
                            if (isMuted) {
                                return <div key={day.toISOString()} className="h-8" />;
                            }
                            return (
                                <button
                                    key={day.toISOString()}
                                    type="button"
                                    onClick={() => commitDatePart(formatDatePart(day))}
                                    className="flex h-8 items-center justify-center"
                                >
                                    <span
                                        className={cn(
                                            "flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition-colors",
                                            isSelected
                                                ? "bg-amber-500 text-white font-bold shadow-lg shadow-amber-500/25"
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

                    {/* Time row */}
                    <div className="flex items-center justify-between pt-1">
                        <span className="text-sm font-semibold text-slate-200">Time</span>
                        <CustomTimePicker
                            value={selectedTimePart}
                            placeholder="--:--"
                            onChange={commitTime}
                            compact
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
