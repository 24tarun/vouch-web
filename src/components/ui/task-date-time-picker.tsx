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
import type { ReactNode } from "react";
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
    mode?: "deadline" | "reminder";
    highlightCalendar?: boolean;
    actions?: ReactNode;
    className?: string;
}

export function TaskDateTimePicker({
    deadlineValue,
    eventStartValue,
    onDeadlineValueChange,
    onEventStartValueChange,
    mode = "deadline",
    highlightCalendar = false,
    actions,
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
        if (mode === "deadline" && selectedStartTime) {
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
        <div className={cn("grid gap-6 sm:grid-cols-[1fr_220px]", className)}>
            {/* Left: Calendar */}
            <div className={cn(highlightCalendar && "rounded-xl bg-slate-800/60")}>
                {/* Month header */}
                <div className="mb-4 flex items-center justify-between">
                    <div className="text-lg font-semibold text-slate-100">
                        {format(visibleMonth, "MMMM yyyy")}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className="flex h-8 w-8 items-center justify-center text-amber-400 transition-colors hover:text-amber-300 disabled:opacity-30 disabled:text-slate-600"
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
                            className="flex h-8 w-8 items-center justify-center text-amber-400 transition-colors hover:text-amber-300"
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
                        <div key={day} className="pb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                            {day}
                        </div>
                    ))}
                </div>

                {/* Calendar grid */}
                <div className="grid grid-cols-7 gap-y-1">
                    {calendarDays.map((day) => {
                        const isSelected = isSameDay(day, selectedDeadline);
                        const isMuted = !isSameMonth(day, visibleMonth);
                        const isPast = isBefore(day, startOfDay(new Date()));
                        if (isMuted) {
                            return <div key={day.toISOString()} className="h-11" aria-hidden="true" />;
                        }

                        return (
                            <button
                                key={day.toISOString()}
                                type="button"
                                disabled={isPast}
                                onClick={() => commitDatePart(formatDatePart(day))}
                                className="flex h-11 items-center justify-center"
                                aria-pressed={isSelected}
                            >
                                <span
                                    className={cn(
                                        "flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium transition-colors",
                                        isSelected
                                            ? "bg-amber-500 text-white font-bold"
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

            {/* Right: Time + Actions */}
            <div className="flex flex-col justify-between gap-5">
                <div className="space-y-4">
                    {mode === "deadline" ? (
                        <TimeRow
                            label="Start (optional)"
                            value={selectedStartTime}
                            placeholder="--:--"
                            onChange={commitStartTime}
                            allowClear
                        />
                    ) : null}
                    <TimeRow
                        label={mode === "deadline" ? "End" : "Time"}
                        value={selectedEndTime}
                        placeholder={mode === "deadline" ? "23:00" : "--:--"}
                        onChange={commitEndTime}
                    />
                </div>
                {actions && <div className="space-y-2.5">{actions}</div>}
            </div>
        </div>
    );
}

interface TimeRowProps {
    label: string;
    value: string;
    placeholder: string;
    allowClear?: boolean;
    onChange: (value: string) => void;
}

function TimeRow({ label, value, placeholder, allowClear = false, onChange }: TimeRowProps) {
    return (
        <div>
            <label className="mb-2 block text-sm text-slate-400">{label}</label>
            <div className="flex items-center gap-2">
                <CustomTimePicker
                    value={value}
                    placeholder={placeholder}
                    onChange={onChange}
                />
                {allowClear && value && (
                    <button
                        type="button"
                        onClick={() => onChange("")}
                        className="rounded-full px-2.5 py-1 text-[11px] font-mono text-slate-500 transition-colors hover:text-red-400"
                    >
                        ✕
                    </button>
                )}
            </div>
        </div>
    );
}
