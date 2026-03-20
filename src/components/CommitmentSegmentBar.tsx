"use client";

import { useMemo } from "react";
import { formatDateOnlyDDMMYYYY } from "@/lib/date-format";
import { cn } from "@/lib/utils";

type SegmentState = "passed" | "failed" | "today" | "future" | "pending";

interface DayStatusInput {
    date: string;
    status: string;
}

interface CommitmentSegmentBarProps {
    startDate: string;
    endDate: string;
    dayStatuses: DayStatusInput[];
    selectedDate?: string | null;
    onSelectDate?: (date: string) => void;
    className?: string;
    heightClassName?: string;
    todayDate?: string;
}

interface Segment {
    date: string;
    state: SegmentState;
}

function parseDateOnlyUtc(dateOnly: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
    const parsed = new Date(`${dateOnly}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
}

function addDays(dateOnly: string, days: number): string {
    const parsed = parseDateOnlyUtc(dateOnly);
    if (!parsed) return dateOnly;
    parsed.setUTCDate(parsed.getUTCDate() + days);
    return parsed.toISOString().slice(0, 10);
}

function getTotalDays(startDate: string, endDate: string): number {
    const start = parseDateOnlyUtc(startDate);
    const end = parseDateOnlyUtc(endDate);
    if (!start || !end) return 1;
    const diff = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    return Math.max(1, diff);
}

function segmentStyle(state: SegmentState): React.CSSProperties {
    if (state === "passed")
        return { background: "linear-gradient(90deg, rgb(6,182,212) 0%, rgb(34,211,238) 100%)" };
    if (state === "failed")
        return { background: "rgba(239,68,68,0.7)" };
    if (state === "today")
        return { background: "linear-gradient(90deg, rgb(34,211,238) 0%, rgb(56,189,248) 100%)" };
    if (state === "future")
        return { background: "rgba(255,255,255,0.04)" };
    return { background: "rgba(255,255,255,0.03)" };
}

function resolveSegmentState(dateOnly: string, dayStatus: string | undefined, todayDateOnly: string): SegmentState {
    if (dateOnly > todayDateOnly) return "future";
    if (dateOnly === todayDateOnly) return "today";
    if (dayStatus === "failed") return "failed";
    if (dayStatus === "passed") return "passed";
    return "pending";
}

export function CommitmentSegmentBar({
    startDate,
    endDate,
    dayStatuses,
    selectedDate = null,
    onSelectDate,
    className,
    heightClassName = "h-3",
    todayDate,
}: CommitmentSegmentBarProps) {
    const todayDateOnly = todayDate || new Date().toISOString().slice(0, 10);

    const segments = useMemo(() => {
        const totalDays = getTotalDays(startDate, endDate);
        const dayStatusByDate = new Map(dayStatuses.map((day) => [day.date, day.status]));
        const next: Segment[] = [];

        for (let index = 0; index < totalDays; index += 1) {
            const dateOnly = addDays(startDate, index);
            const state = resolveSegmentState(dateOnly, dayStatusByDate.get(dateOnly), todayDateOnly);
            next.push({ date: dateOnly, state });
        }

        return next;
    }, [dayStatuses, endDate, startDate, todayDateOnly]);

    const hasGlow = segments.some((s) => s.state === "passed" || s.state === "today");

    return (
        <div
            className={cn("relative w-full overflow-hidden rounded-full", heightClassName, className)}
            style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.05)",
            }}
        >
            <div
                className="grid h-full gap-px"
                style={{
                    gridTemplateColumns: `repeat(${Math.max(1, segments.length)}, minmax(0, 1fr))`,
                }}
            >
                {segments.map((segment, index) => {
                    const label = `${formatDateOnlyDDMMYYYY(segment.date)}: ${segment.state}`;
                    const isFirst = index === 0;
                    const isLast = index === segments.length - 1;
                    const isSelected = selectedDate === segment.date;
                    const baseClassName = cn(
                        "h-full",
                        isFirst && "rounded-l-full",
                        isLast && "rounded-r-full",
                        isSelected && "ring-1 ring-white/90 ring-inset z-10 relative",
                    );

                    if (onSelectDate) {
                        return (
                            <button
                                key={segment.date}
                                type="button"
                                aria-label={label}
                                title={label}
                                className={cn(baseClassName, "focus-visible:ring-1 focus-visible:ring-white focus-visible:ring-inset")}
                                style={segmentStyle(segment.state)}
                                onClick={() => onSelectDate(segment.date)}
                            />
                        );
                    }

                    return (
                        <span
                            key={segment.date}
                            aria-label={label}
                            title={label}
                            className={baseClassName}
                            style={segmentStyle(segment.state)}
                        />
                    );
                })}
            </div>
            {hasGlow && (
                <div
                    className="pointer-events-none absolute inset-0 rounded-full"
                    style={{ boxShadow: "0 0 10px 1px rgba(34,211,238,0.3)" }}
                />
            )}
        </div>
    );
}
