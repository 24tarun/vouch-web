"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { CalendarDays, ChevronLeft, ChevronRight, Minus, Plus, RotateCcw } from "lucide-react";
import { ReminderLine } from "@/components/ui/reminder-date-time-picker";
import { combineDateAndTime, fromDateTimeLocalValue } from "@/lib/datetime-local";
import { cn } from "@/lib/utils";

const WEEKDAY_HEADERS = ["M", "T", "W", "T", "F", "S", "S"];

export interface InlineScheduledReminder {
    key: string;
    at: Date;
}

interface InlineTaskScheduleProps {
    deadline: Date;
    reminders: InlineScheduledReminder[];
    onDeadlineChange: (deadline: Date) => boolean;
    onAddReminder: (reminder: Date) => boolean;
    onRemoveReminder: (key: string) => void;
    /** Restores the deadline the title parser / profile default would produce. */
    onResetDeadline?: () => void;
    /** Reminder keys armed to ring as an alarm rather than a plain notification. */
    urgentReminderKeys?: string[];
    onToggleUrgentReminder?: (key: string) => void;
    /** Alarm-style delivery is only offered when the profile has it switched on. */
    alarmNotificationsEnabled?: boolean;
    disabled?: boolean;
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

export function dateFromNow(now: Date, minutes: number): Date {
    const next = new Date(now.getTime() + minutes * 60_000);
    next.setSeconds(0, 0);
    return next;
}

export function timeOnDate(date: Date, time: string): Date | null {
    return fromDateTimeLocalValue(combineDateAndTime(format(date, "yyyy-MM-dd"), time));
}

export function shiftReminderPart(date: Date, part: "hour" | "minute", delta: number): Date {
    const next = new Date(date);
    if (part === "hour") {
        next.setHours(next.getHours() + delta);
    } else {
        next.setMinutes(next.getMinutes() + delta);
    }
    next.setSeconds(0, 0);
    return next;
}

/** Clamps a typed "23" / "7" style entry into the valid range for its clock part. */
export function clampClockPart(raw: string, part: "hour" | "minute"): number | null {
    const digits = raw.replace(/\D/g, "").slice(0, 2);
    if (!digits) return null;
    const parsed = Number.parseInt(digits, 10);
    return Math.min(parsed, part === "hour" ? 23 : 59);
}

export function setClockPart(date: Date, part: "hour" | "minute", value: number): Date {
    const next = new Date(date);
    if (part === "hour") {
        next.setHours(value);
    } else {
        next.setMinutes(value);
    }
    next.setSeconds(0, 0);
    return next;
}

/** New reminders start half an hour before the deadline, or now when that already passed. */
function defaultReminderDraft(deadline: Date, now: Date): Date {
    const halfHourBefore = new Date(deadline.getTime() - 30 * 60_000);
    halfHourBefore.setSeconds(0, 0);
    if (halfHourBefore.getTime() > now.getTime()) return halfHourBefore;

    const currentMinute = dateFromNow(now, 0);
    if (currentMinute.getTime() <= deadline.getTime()) return currentMinute;
    return new Date(deadline);
}

const DEADLINE_PRESETS = [
    { minutes: 60, label: "in 1 hour" },
    { minutes: 180, label: "in 3 hours" },
    { minutes: 360, label: "in 6 hours" },
];

/** Reminder shortcuts are anchored to the deadline, not to the wall clock. */
const REMINDER_PRESETS = [
    { minutes: 10, label: "10m before" },
    { minutes: 60, label: "1h before" },
    { minutes: 24 * 60, label: "1d before" },
];

export function offsetBeforeDeadline(deadline: Date, minutesBefore: number): Date {
    const next = new Date(deadline.getTime() - minutesBefore * 60_000);
    next.setSeconds(0, 0);
    return next;
}

/** Resting look for every secondary control: filled + bordered so it reads as clickable. */
const CONTROL_CLASS =
    "border border-slate-600/70 bg-slate-700/40 text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-600/50 hover:text-white";

const ACCENTS = {
    emerald: "border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-100 focus:border-emerald-400/60",
    amber: "border-amber-400/25 bg-amber-400/[0.06] text-amber-200 focus:border-amber-400/60",
} as const;

/** A typeable `HH` or `MM` cell flanked by single-step minus/plus buttons. */
function ClockPart({
    part,
    value,
    accent,
    ariaPrefix,
    onNudge,
    onCommit,
}: {
    part: "hour" | "minute";
    value: string;
    accent: keyof typeof ACCENTS;
    ariaPrefix: string;
    onNudge: (delta: number) => void;
    onCommit: (value: number) => void;
}) {
    const [draft, setDraft] = useState<string | null>(null);

    const commit = () => {
        if (draft === null) return;
        const parsed = clampClockPart(draft, part);
        setDraft(null);
        if (parsed !== null) onCommit(parsed);
    };

    return (
        <div className="flex items-center gap-1">
            <button
                type="button"
                onClick={() => onNudge(-1)}
                aria-label={`${ariaPrefix} ${part} minus 1`}
                className={cn("flex h-8 w-7 items-center justify-center rounded-md", CONTROL_CLASS)}
            >
                <Minus className="h-3 w-3" />
            </button>
            <input
                type="text"
                inputMode="numeric"
                aria-label={`${ariaPrefix} ${part}`}
                value={draft ?? value}
                onChange={(event) => setDraft(event.target.value)}
                onFocus={(event) => event.target.select()}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        commit();
                        event.currentTarget.blur();
                        return;
                    }
                    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                        event.preventDefault();
                        setDraft(null);
                        onNudge(event.key === "ArrowUp" ? 1 : -1);
                        return;
                    }
                    if (event.key === "Escape") setDraft(null);
                }}
                className={cn(
                    "h-8 w-11 rounded-md border text-center text-sm font-semibold tabular-nums outline-none transition-colors",
                    ACCENTS[accent]
                )}
            />
            <button
                type="button"
                onClick={() => onNudge(1)}
                aria-label={`${ariaPrefix} ${part} plus 1`}
                className={cn("flex h-8 w-7 items-center justify-center rounded-md", CONTROL_CLASS)}
            >
                <Plus className="h-3 w-3" />
            </button>
        </div>
    );
}

/**
 * `- HH + : - MM +` on one line. Shared by the deadline column and the
 * add-reminder popover so both clocks behave identically.
 */
export function ClockStepper({
    value,
    accent,
    ariaPrefix,
    onChange,
}: {
    value: Date;
    accent: keyof typeof ACCENTS;
    ariaPrefix: string;
    onChange: (next: Date) => void;
}) {
    return (
        <div className="flex items-center justify-center gap-1.5">
            <ClockPart
                part="hour"
                value={format(value, "HH")}
                accent={accent}
                ariaPrefix={ariaPrefix}
                onNudge={(delta) => onChange(shiftReminderPart(value, "hour", delta))}
                onCommit={(hour) => onChange(setClockPart(value, "hour", hour))}
            />
            <span aria-hidden="true" className="text-sm font-semibold text-slate-600">:</span>
            <ClockPart
                part="minute"
                value={format(value, "mm")}
                accent={accent}
                ariaPrefix={ariaPrefix}
                onNudge={(delta) => onChange(shiftReminderPart(value, "minute", delta))}
                onCommit={(minute) => onChange(setClockPart(value, "minute", minute))}
            />
        </div>
    );
}

export function InlineTaskSchedule({
    deadline,
    reminders,
    onDeadlineChange,
    onAddReminder,
    onRemoveReminder,
    onResetDeadline,
    urgentReminderKeys = [],
    onToggleUrgentReminder,
    alarmNotificationsEnabled = false,
    disabled = false,
}: InlineTaskScheduleProps) {
    const effectiveDeadline = deadline;
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [isReminderOpen, setIsReminderOpen] = useState(false);
    const [visibleMonth, setVisibleMonth] = useState(startOfMonth(effectiveDeadline));
    const [reminderDraft, setReminderDraft] = useState(() => defaultReminderDraft(effectiveDeadline, new Date()));
    const calendarRef = useRef<HTMLDivElement>(null);
    const reminderRef = useRef<HTMLDivElement>(null);
    const currentMonth = startOfMonth(new Date());
    const canGoToPreviousMonth = visibleMonth.getTime() > currentMonth.getTime();
    const calendarDays = useMemo(() => getCalendarDays(visibleMonth), [visibleMonth]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (calendarRef.current && !calendarRef.current.contains(target)) {
                setIsCalendarOpen(false);
            }
            if (reminderRef.current && !reminderRef.current.contains(target)) {
                setIsReminderOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const changeDay = (delta: number) => {
        onDeadlineChange(addDays(effectiveDeadline, delta));
    };

    const toggleReminderPopover = () => {
        setReminderDraft(defaultReminderDraft(effectiveDeadline, new Date()));
        setIsReminderOpen((open) => !open);
    };

    const addReminder = (reminder: Date) => {
        if (onAddReminder(reminder)) {
            setIsReminderOpen(false);
        }
    };

    return (
        <div className={cn("flex w-full min-w-0 flex-wrap items-stretch gap-2 overflow-visible pb-0.5", disabled && "pointer-events-none opacity-50")}>
            <div
                role="group"
                aria-label="Deadline"
                className="flex w-[336px] shrink-0 flex-col gap-1.5 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.03] p-2"
            >
                <div ref={calendarRef} className="relative flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => changeDay(-1)}
                        disabled={isBefore(addDays(effectiveDeadline, -1), new Date())}
                        aria-label="Previous deadline day"
                        className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:opacity-30", CONTROL_CLASS)}
                    >
                        <Minus className="h-3.5 w-3.5" />
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setVisibleMonth(startOfMonth(effectiveDeadline));
                            setIsCalendarOpen((open) => !open);
                        }}
                        aria-expanded={isCalendarOpen}
                        className={cn(
                            "flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border border-emerald-400/25 bg-emerald-400/[0.06] px-2.5 text-[11px] font-semibold tabular-nums text-emerald-100 transition-colors hover:bg-emerald-400/[0.12]",
                            isCalendarOpen && "border-emerald-400/60"
                        )}
                    >
                        <CalendarDays className="h-3.5 w-3.5" />
                        {format(effectiveDeadline, "dd MMM yyyy")}
                    </button>
                    <button
                        type="button"
                        onClick={() => changeDay(1)}
                        aria-label="Next deadline day"
                        className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", CONTROL_CLASS)}
                    >
                        <Plus className="h-3.5 w-3.5" />
                    </button>

                    {isCalendarOpen && (
                        <div className="absolute bottom-full left-0 z-50 mb-2 w-[272px] rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-2xl shadow-black/60">
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-xs font-semibold text-slate-200">{format(visibleMonth, "MMMM yyyy")}</span>
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() => setVisibleMonth((month) => subMonths(month, 1))}
                                        disabled={!canGoToPreviousMonth}
                                        aria-label="Previous month"
                                        className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30"
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setVisibleMonth((month) => addMonths(month, 1))}
                                        aria-label="Next month"
                                        className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white"
                                    >
                                        <ChevronRight className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                            <div className="grid grid-cols-7 text-center">
                                {WEEKDAY_HEADERS.map((day, index) => (
                                    <span key={`${day}-${index}`} className="pb-1 text-[9px] font-semibold text-slate-600">{day}</span>
                                ))}
                            </div>
                            <div className="grid grid-cols-7">
                                {calendarDays.map((day) => {
                                    const isPast = isBefore(day, startOfDay(new Date()));
                                    const isSelected = isSameDay(day, effectiveDeadline);
                                    if (!isSameMonth(day, visibleMonth)) {
                                        return <span key={day.toISOString()} className="h-8" aria-hidden="true" />;
                                    }
                                    return (
                                        <button
                                            key={day.toISOString()}
                                            type="button"
                                            disabled={isPast}
                                            onClick={() => {
                                                const next = new Date(day);
                                                next.setHours(effectiveDeadline.getHours(), effectiveDeadline.getMinutes(), 0, 0);
                                                if (onDeadlineChange(next)) setIsCalendarOpen(false);
                                            }}
                                            className="flex h-8 items-center justify-center disabled:cursor-not-allowed"
                                        >
                                            <span className={cn(
                                                "flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition-colors",
                                                isSelected ? "bg-emerald-400 font-bold text-slate-950" : "text-slate-300 hover:bg-slate-800 hover:text-white",
                                                isToday(day) && !isSelected && "text-emerald-300",
                                                isPast && "text-slate-700 hover:bg-transparent hover:text-slate-700"
                                            )}>
                                                {format(day, "d")}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                <ClockStepper
                    value={effectiveDeadline}
                    accent="emerald"
                    ariaPrefix="Deadline"
                    onChange={onDeadlineChange}
                />

                <div className="flex items-center gap-1 border-t border-slate-800/60 pt-1.5">
                    {DEADLINE_PRESETS.map((preset) => (
                        <button
                            key={preset.minutes}
                            type="button"
                            onClick={() => onDeadlineChange(dateFromNow(new Date(), preset.minutes))}
                            aria-label={`Set deadline ${preset.label}`}
                            className={cn("h-7 flex-1 rounded-md text-[10px] font-medium", CONTROL_CLASS)}
                        >
                            {preset.label}
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={() => {
                            const next = addDays(startOfDay(new Date()), 1);
                            next.setHours(9, 0, 0, 0);
                            onDeadlineChange(next);
                        }}
                        aria-label="Set deadline tomorrow at 9am"
                        className={cn("h-7 flex-1 rounded-md text-[10px] font-medium", CONTROL_CLASS)}
                    >
                        tmrw 9am
                    </button>
                    {onResetDeadline && (
                        <button
                            type="button"
                            onClick={onResetDeadline}
                            aria-label="Reset deadline"
                            title="Back to the default deadline"
                            className={cn(
                                "flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium",
                                CONTROL_CLASS
                            )}
                        >
                            <RotateCcw className="h-3 w-3" />
                            Reset
                        </button>
                    )}
                </div>
            </div>

            <div
                role="group"
                aria-label="Reminders"
                className="flex min-w-[320px] flex-1 flex-col gap-0.5 rounded-xl border border-amber-400/15 bg-amber-400/[0.03] p-2"
            >
                <span className="px-0.5 pb-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-400/60">
                    Reminders
                </span>

                {reminders.length === 0 && (
                    <p className="px-0.5 py-1.5 text-[11px] text-slate-600">
                        No reminders — add one below.
                    </p>
                )}

                {reminders.map((reminder) => (
                    <ReminderLine
                        key={reminder.key}
                        at={reminder.at}
                        status="scheduled"
                        urgent={urgentReminderKeys.includes(reminder.key)}
                        showAlarm={alarmNotificationsEnabled}
                        onToggleUrgent={() => onToggleUrgentReminder?.(reminder.key)}
                        onDelete={() => onRemoveReminder(reminder.key)}
                    />
                ))}

                <div ref={reminderRef} className="relative mt-auto pt-1">
                    <button
                        type="button"
                        onClick={toggleReminderPopover}
                        aria-expanded={isReminderOpen}
                        className={cn(
                            "flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-slate-600/70 bg-slate-700/40 text-[11px] font-medium text-slate-200 transition-colors hover:border-amber-400/50 hover:bg-amber-400/15 hover:text-amber-100",
                            isReminderOpen && "border-amber-400/50 bg-amber-400/15 text-amber-100"
                        )}
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Add reminder
                    </button>

                    {isReminderOpen && (
                        <div className="absolute bottom-full left-0 z-50 mb-2 w-[264px] space-y-2 rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-2xl shadow-black/60">
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => setReminderDraft((current) => addDays(current, -1))}
                                    aria-label="Previous reminder day"
                                    className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", CONTROL_CLASS)}
                                >
                                    <Minus className="h-3.5 w-3.5" />
                                </button>
                                <span className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border border-amber-400/25 bg-amber-400/[0.06] px-2 text-[11px] font-semibold tabular-nums text-amber-200">
                                    <CalendarDays className="h-3.5 w-3.5" />
                                    {format(reminderDraft, "dd MMM yyyy")}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setReminderDraft((current) => addDays(current, 1))}
                                    aria-label="Next reminder day"
                                    className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", CONTROL_CLASS)}
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                </button>
                            </div>

                            <ClockStepper
                                value={reminderDraft}
                                accent="amber"
                                ariaPrefix="Reminder"
                                onChange={setReminderDraft}
                            />

                            <div className="flex items-center gap-1">
                                {REMINDER_PRESETS.map((preset) => (
                                    <button
                                        key={preset.minutes}
                                        type="button"
                                        onClick={() => setReminderDraft(offsetBeforeDeadline(effectiveDeadline, preset.minutes))}
                                        aria-label={`Reminder ${preset.label}`}
                                        className={cn("h-7 flex-1 rounded-md text-[10px] font-medium", CONTROL_CLASS)}
                                    >
                                        {preset.label}
                                    </button>
                                ))}
                            </div>

                            <div className="flex items-center gap-1.5 border-t border-slate-800 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setIsReminderOpen(false)}
                                    className="h-7 flex-1 rounded-md text-[10px] font-medium text-slate-500 transition-colors hover:bg-slate-800 hover:text-white"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={() => addReminder(reminderDraft)}
                                    aria-label="Confirm reminder"
                                    className="h-7 flex-1 rounded-md bg-amber-400/90 text-[10px] font-semibold text-slate-950 transition-colors hover:bg-amber-300"
                                >
                                    Add reminder
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
