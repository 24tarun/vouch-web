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
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

interface TaskDateTimePickerProps {
    deadlineValue: string;
    eventStartValue: string;
    onDeadlineValueChange: (value: string) => void;
    onEventStartValueChange: (value: string) => void;
    actions?: ReactNode;
    className?: string;
}

export function TaskDateTimePicker({
    deadlineValue,
    eventStartValue,
    onDeadlineValueChange,
    onEventStartValueChange,
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
        <div className={cn("grid gap-5 sm:grid-cols-[minmax(0,1fr)_180px]", className)}>
            <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-slate-100">
                        {format(visibleMonth, "MMMM yyyy")}
                    </div>
                    <div className="flex items-center gap-1">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="h-8 w-8 text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
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
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="h-8 w-8 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                            onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
                            aria-label="Next month"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
                        <div key={`${day}-${index}`} className="h-6">
                            {day}
                        </div>
                    ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                    {calendarDays.map((day) => {
                        const isSelected = isSameDay(day, selectedDeadline);
                        const isMuted = !isSameMonth(day, visibleMonth);
                        if (isMuted) {
                            return <div key={day.toISOString()} className="h-9" aria-hidden="true" />;
                        }

                        return (
                            <button
                                key={day.toISOString()}
                                type="button"
                                onClick={() => commitDatePart(formatDatePart(day))}
                                className={cn(
                                    "flex h-9 items-center justify-center rounded-lg border text-sm transition-colors",
                                    isSelected
                                        ? "border-blue-400/50 bg-blue-500/20 text-blue-100 shadow-[0_0_0_1px_rgba(96,165,250,0.18)]"
                                        : "border-transparent text-slate-300 hover:border-slate-700 hover:bg-slate-800/80 hover:text-white",
                                    isMuted && !isSelected && "text-slate-600 hover:text-slate-300",
                                    isToday(day) && !isSelected && "text-blue-300"
                                )}
                                aria-pressed={isSelected}
                            >
                                {format(day, "d")}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="flex flex-col justify-between gap-4">
                <div className="space-y-3">
                <TimeControl
                    label="Start (optional)"
                    value={selectedStartTime}
                    placeholder="Optional"
                    onChange={commitStartTime}
                    allowClear
                />
                <TimeControl
                    label="End"
                    value={selectedEndTime}
                    placeholder="23:00"
                    onChange={commitEndTime}
                />
                </div>
                {actions && <div className="space-y-2">{actions}</div>}
            </div>
        </div>
    );
}

interface TimeControlProps {
    label: string;
    value: string;
    placeholder: string;
    allowClear?: boolean;
    onChange: (value: string) => void;
}

function TimeControl({ label, value, placeholder, allowClear = false, onChange }: TimeControlProps) {
    return (
        <div>
            <label className="mb-1.5 block text-xs text-slate-400">
                {label}
            </label>
            <div className="flex items-center gap-1.5">
                <Input
                    type="time"
                    value={value}
                    placeholder={placeholder}
                    onChange={(event) => onChange(event.target.value)}
                    className="h-9 border-slate-700 bg-slate-950/60 px-2 text-sm text-slate-100 [color-scheme:dark] focus-visible:border-blue-400 focus-visible:ring-blue-400/20"
                />
                {allowClear && value && (
                    <button
                        type="button"
                        onClick={() => onChange("")}
                        className="h-9 rounded-md border border-slate-700 bg-slate-950/50 px-2 text-[11px] font-mono text-slate-500 transition-colors hover:border-red-400/40 hover:text-red-300"
                    >
                        Clear
                    </button>
                )}
            </div>
        </div>
    );
}
