"use client";

import { useMemo, useState } from "react";
import {
    addDays,
    addMonths,
    endOfMonth,
    endOfWeek,
    format,
    isBefore,
    isSameDay,
    isSameMonth,
    isToday,
    startOfDay,
    startOfMonth,
    startOfWeek,
    subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CustomTimePicker } from "@/components/ui/custom-time-picker";
import {
    combineDateAndTime,
    fromDateTimeLocalValue,
    getDatePartFromLocalDateTime,
    getTimePartFromLocalDateTime,
} from "@/lib/datetime-local";
import { cn } from "@/lib/utils";

const WEEKDAY_HEADERS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];


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

interface TaskDateTimePickerProps {
    deadlineValue: string;
    eventStartValue: string;
    onDeadlineValueChange: (value: string) => void;
    onEventStartValueChange: (value: string) => void;
    className?: string;
}

export function TaskDateTimePicker({
    deadlineValue,
    eventStartValue,
    onDeadlineValueChange,
    onEventStartValueChange,
    className,
}: TaskDateTimePickerProps) {
    const selectedDeadline = fromDateTimeLocalValue(deadlineValue) ?? new Date();
    const selectedDatePart = getDatePartFromLocalDateTime(deadlineValue) || formatDatePart(selectedDeadline);
    const selectedEndTime = getTimePartFromLocalDateTime(deadlineValue) || "23:00";
    const selectedStartTime = getTimePartFromLocalDateTime(eventStartValue);
    const currentMonth = startOfMonth(new Date());
    const selectedMonth = startOfMonth(selectedDeadline);
    const [visibleMonth, setVisibleMonth] = useState(
        selectedMonth.getTime() < currentMonth.getTime() ? currentMonth : selectedMonth
    );
    const canGoToPreviousMonth = visibleMonth.getTime() > currentMonth.getTime();

    const calendarDays = useMemo(() => getCalendarDays(visibleMonth), [visibleMonth]);

    const commitDatePart = (nextDatePart: string) => {
        const nextDate = fromDateTimeLocalValue(combineDateAndTime(nextDatePart, selectedEndTime));
        if (nextDate) {
            setVisibleMonth(startOfMonth(nextDate));
        }
        onDeadlineValueChange(combineDateAndTime(nextDatePart, selectedEndTime));
        if (selectedStartTime) {
            onEventStartValueChange(combineDateAndTime(nextDatePart, selectedStartTime));
        }
    };

    const commitStartTime = (time: string) => {
        if (!time) {
            onEventStartValueChange("");
            return;
        }
        onEventStartValueChange(combineDateAndTime(selectedDatePart, time));
    };

    const commitEndTime = (time: string) => {
        if (!time) return;
        onDeadlineValueChange(combineDateAndTime(selectedDatePart, time));
    };

    return (
        <div className={cn("grid gap-6 md:grid-cols-[minmax(0,1fr)_230px]", className)}>
            {/* Left: Calendar */}
            <div>
                {/* Month header */}
                <div className="mb-3 flex items-center justify-between">
                    <div className="text-base font-semibold text-slate-100 sm:text-lg">
                        {format(visibleMonth, "MMMM yyyy")}
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:text-slate-700"
                            disabled={!canGoToPreviousMonth}
                            onClick={() => {
                                if (!canGoToPreviousMonth) return;
                                setVisibleMonth((current) => {
                                    const previous = subMonths(current, 1);
                                    return previous.getTime() < currentMonth.getTime() ? currentMonth : previous;
                                });
                            }}
                            aria-label="Previous month"
                        >
                            <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
                        </button>
                        <button
                            type="button"
                            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
                            onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
                            aria-label="Next month"
                        >
                            <ChevronRight className="h-5 w-5" strokeWidth={2.5} />
                        </button>
                    </div>
                </div>

                {/* Weekday headers */}
                <div className="grid grid-cols-7 text-center">
                    {WEEKDAY_HEADERS.map((day) => (
                        <div key={day} className="pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600 sm:text-[11px]">
                            {day}
                        </div>
                    ))}
                </div>

                {/* Calendar grid */}
                <div className="grid grid-cols-7 gap-y-0.5">
                    {calendarDays.map((day) => {
                        const isSelected = isSameDay(day, selectedDeadline);
                        const isMuted = !isSameMonth(day, visibleMonth);
                        const isPast = isBefore(day, startOfDay(new Date()));
                        if (isMuted) {
                            return <div key={day.toISOString()} className="h-10" aria-hidden="true" />;
                        }

                        return (
                            <button
                                key={day.toISOString()}
                                type="button"
                                disabled={isPast}
                                onClick={() => commitDatePart(formatDatePart(day))}
                                className="flex h-10 items-center justify-center"
                                aria-pressed={isSelected}
                            >
                                <span
                                    className={cn(
                                        "flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors",
                                        isSelected
                                            ? "bg-amber-500 text-slate-950 font-bold shadow-[0_0_0_3px_rgba(245,158,11,0.12)]"
                                            : "text-slate-400 hover:bg-slate-800/60 hover:text-white",
                                        isPast && "text-slate-700 cursor-not-allowed hover:bg-transparent hover:text-slate-700",
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

            {/* Right: Time */}
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-1 md:content-start">
                <div>
                    <div className="mb-1.5 flex items-center justify-between">
                        <label className="text-sm text-slate-400">Start</label>
                        {selectedStartTime && (
                            <button
                                type="button"
                                onClick={() => commitStartTime("")}
                                className="text-xs text-slate-600 transition-colors hover:text-red-400"
                                aria-label="Clear start time"
                            >
                                Clear
                            </button>
                        )}
                    </div>
                    <CustomTimePicker
                        ariaLabel="Start time"
                        value={selectedStartTime}
                        placeholder="--:--"
                        onChange={commitStartTime}
                    />
                </div>
                <div>
                    <label className="mb-1.5 block text-sm text-slate-400">End</label>
                    <CustomTimePicker
                        ariaLabel="End time"
                        value={selectedEndTime}
                        placeholder="23:00"
                        onChange={commitEndTime}
                    />
                </div>
            </div>
        </div>
    );
}
