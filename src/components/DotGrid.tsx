"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { formatDateOnlyDDMMYYYY } from "@/lib/date-format";

export type DotDayStatus = "passed" | "failed" | "pending" | "future";

interface DotGridDay {
    date: string;
    status: DotDayStatus;
}

interface DotGridProps {
    days: DotGridDay[];
    todayDate?: string;
    compact?: boolean;
    onDayClick?: (date: string) => void;
}

interface DotCell {
    date: string;
    status: DotDayStatus;
}

function weekdayToMondayIndex(weekday: number): number {
    // JS: 0=Sunday, 1=Monday, ... 6=Saturday. We want Monday-first index.
    return (weekday + 6) % 7;
}

function dotColorClass(status: DotDayStatus): string {
    if (status === "passed") return "bg-emerald-500";
    if (status === "failed") return "bg-red-500";
    if (status === "pending") return "bg-slate-600";
    return "bg-slate-700";
}

export function DotGrid({ days, todayDate, compact = false, onDayClick }: DotGridProps) {
    const resolvedTodayDate = todayDate || new Date().toISOString().slice(0, 10);
    const normalizedDays = useMemo(() => {
        const byDate = new Map<string, DotCell>();
        for (const day of days) {
            if (!day?.date) continue;
            byDate.set(day.date, { date: day.date, status: day.status });
        }
        return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    }, [days]);

    const cells = useMemo(() => {
        if (normalizedDays.length === 0) return [] as Array<DotCell | null>;
        const firstDate = new Date(`${normalizedDays[0].date}T00:00:00.000Z`);
        if (Number.isNaN(firstDate.getTime())) return normalizedDays;

        const prefixCount = weekdayToMondayIndex(firstDate.getUTCDay());
        const prefixed: Array<DotCell | null> = [];
        for (let i = 0; i < prefixCount; i += 1) {
            prefixed.push(null);
        }
        return prefixed.concat(normalizedDays);
    }, [normalizedDays]);

    if (normalizedDays.length === 0) {
        return <p className="text-xs text-slate-500">No scheduled days in this range.</p>;
    }

    const dotSizeClass = compact ? "h-2.5 w-2.5" : "h-4 w-4";

    return (
        <div className="inline-flex flex-col gap-2">
            <div className="grid grid-flow-col auto-cols-max grid-rows-7 gap-1">
                {cells.map((cell, index) => {
                    if (!cell) {
                        return <span key={`blank-${index}`} className={cn(dotSizeClass, "opacity-0")} />;
                    }

                    const isToday = cell.date === resolvedTodayDate;
                    const className = cn(
                        dotSizeClass,
                        "rounded-[4px] transition-transform",
                        dotColorClass(cell.status),
                        compact ? "" : "hover:scale-110 focus-visible:scale-110",
                        isToday ? "ring-2 ring-white/50" : ""
                    );

                    const label = `${formatDateOnlyDDMMYYYY(cell.date)}: ${cell.status}`;
                    if (!compact && onDayClick) {
                        return (
                            <button
                                key={cell.date}
                                type="button"
                                className={className}
                                onClick={() => onDayClick(cell.date)}
                                aria-label={label}
                                title={label}
                            />
                        );
                    }

                    return <span key={cell.date} className={className} aria-label={label} title={label} />;
                })}
            </div>
        </div>
    );
}
