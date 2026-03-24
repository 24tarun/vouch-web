"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { DayStatus } from "@/lib/commitment-status";

interface CommitmentDayStripProps {
    startDate: string;
    endDate: string;
    dayStatuses: { date: string; status: DayStatus }[];
    selectedDate?: string | null;
    onSelectDate?: (date: string) => void;
}

const CELL_W = 48;
const CELL_H = 60;

function generateDates(start: string, end: string): string[] {
    const dates: string[] = [];
    const cursor = new Date(`${start}T00:00:00.000Z`);
    const last = new Date(`${end}T00:00:00.000Z`);
    while (cursor <= last) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
}

function getToday(): string {
    return new Date().toISOString().slice(0, 10);
}

function cellStyle(status: DayStatus | undefined, isToday: boolean, isSelected: boolean): React.CSSProperties {
    if (isSelected) {
        return {
            background: "rgba(234,179,8,0.10)",
            border: "1px solid rgba(250,204,21,0.70)",
            color: "rgb(254,240,138)",
            boxShadow: "0 0 10px rgba(250,204,21,0.20)",
        };
    }
    if (isToday) {
        return {
            background: "rgba(59,130,246,0.15)",
            border: "1px solid rgba(96,165,250,0.5)",
            color: "rgb(147,197,253)",
            boxShadow: "0 0 8px rgba(59,130,246,0.2)",
        };
    }
    if (status === "passed") {
        return {
            background: "rgba(34,197,94,0.10)",
            border: "1px solid rgba(74,222,128,0.25)",
            color: "rgb(74,222,128)",
        };
    }
    if (status === "failed") {
        return {
            background: "rgba(239,68,68,0.10)",
            border: "1px solid rgba(248,113,113,0.25)",
            color: "rgb(248,113,113)",
        };
    }
    if (status === "pending") {
        return {
            background: "rgba(51,65,85,0.30)",
            border: "1px solid rgba(100,116,139,0.25)",
            color: "rgb(148,163,184)",
        };
    }
    // future or no tasks
    return {
        background: "rgba(15,23,42,0.40)",
        border: "1px solid rgba(51,65,85,0.20)",
        color: "rgb(71,85,105)",
    };
}

function dotColor(status: DayStatus | undefined, isToday: boolean): string {
    if (isToday) return "rgb(96,165,250)";
    if (status === "passed") return "rgb(74,222,128)";
    if (status === "failed") return "rgb(248,113,113)";
    return "transparent";
}

export function CommitmentDayStrip({
    startDate,
    endDate,
    dayStatuses,
    selectedDate = null,
    onSelectDate,
}: CommitmentDayStripProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const todayRef = useRef<HTMLButtonElement>(null);
    const today = getToday();

    const statusMap = new Map(dayStatuses.map((d) => [d.date, d.status]));
    const dates = generateDates(startDate, endDate);

    useEffect(() => {
        const container = scrollRef.current;
        const todayEl = todayRef.current;
        if (!container || !todayEl) return;
        const containerWidth = container.offsetWidth;
        const todayLeft = todayEl.offsetLeft;
        container.scrollLeft = todayLeft - containerWidth / 2 + CELL_W / 2;
    }, []);

    if (dates.length === 0) return null;

    return (
        <div
            ref={scrollRef}
            className="overflow-x-auto"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
            <div className="flex flex-nowrap gap-1 py-1" style={{ width: "max-content" }}>
                {dates.map((date) => {
                    const isToday = date === today;
                    const isSelected = selectedDate === date;
                    const isFuture = date > today;
                    const status = statusMap.get(date);
                    const dayNum = parseInt(date.slice(8), 10);
                    const monthShort = new Date(`${date}T00:00:00.000Z`).toLocaleString("en", {
                        month: "short",
                        timeZone: "UTC",
                    });
                    const dot = dotColor(status, isToday);

                    return (
                        <button
                            key={date}
                            type="button"
                            ref={isToday ? todayRef : undefined}
                            onClick={() => {
                                if (isFuture) {
                                    toast.error("Wait for tmrw dont hurry");
                                    return;
                                }
                                onSelectDate?.(date);
                            }}
                            className={`flex flex-col items-center justify-center rounded select-none flex-shrink-0 ${isFuture ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
                            style={{ width: CELL_W, height: CELL_H, ...cellStyle(status, isToday, isSelected) }}
                            aria-pressed={isSelected}
                            aria-disabled={isFuture}
                            aria-label={`Filter tasks for ${date}`}
                        >
                            <span
                                style={{
                                    fontSize: 9,
                                    fontWeight: 600,
                                    letterSpacing: "0.08em",
                                    textTransform: "uppercase",
                                    opacity: 0.7,
                                    lineHeight: 1,
                                }}
                            >
                                {monthShort}
                            </span>
                            <span
                                style={{
                                    fontSize: "1.05rem",
                                    fontWeight: 600,
                                    lineHeight: 1,
                                    marginTop: 3,
                                }}
                            >
                                {dayNum}
                            </span>
                            <div
                                style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: "50%",
                                    marginTop: 5,
                                    background: dot,
                                }}
                            />
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
