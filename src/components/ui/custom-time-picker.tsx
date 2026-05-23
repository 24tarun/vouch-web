"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface CustomTimePickerProps {
    value: string;
    placeholder?: string;
    onChange: (value: string) => void;
    className?: string;
    compact?: boolean;
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

function ScrollColumn({
    items,
    selected,
    onSelect,
}: {
    items: string[];
    selected: string;
    onSelect: (value: string) => void;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const selectedRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (selectedRef.current && containerRef.current) {
            const container = containerRef.current;
            const el = selectedRef.current;
            const top = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
            container.scrollTo({ top, behavior: "instant" });
        }
    }, [selected]);

    return (
        <div
            ref={containerRef}
            className="h-[200px] w-[58px] overflow-y-auto overscroll-contain scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-transparent"
        >
            <div className="py-[80px]">
                {items.map((item) => {
                    const isSelected = item === selected;
                    return (
                        <button
                            key={item}
                            ref={isSelected ? selectedRef : undefined}
                            type="button"
                            onClick={() => onSelect(item)}
                            className={cn(
                                "flex h-9 w-full items-center justify-center rounded-md text-sm font-mono transition-colors",
                                isSelected
                                    ? "bg-amber-500/20 text-amber-200 font-semibold"
                                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                            )}
                        >
                            {item}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export function CustomTimePicker({ value, placeholder = "--:--", onChange, className, compact = false }: CustomTimePickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const [hour, minute] = value ? value.split(":") : ["", ""];
    const displayValue = value || placeholder;

    const handleHourSelect = useCallback(
        (h: string) => {
            const m = minute || "00";
            onChange(`${h}:${m}`);
        },
        [minute, onChange]
    );

    const handleMinuteSelect = useCallback(
        (m: string) => {
            const h = hour || "00";
            onChange(`${h}:${m}`);
        },
        [hour, onChange]
    );

    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isOpen]);

    return (
        <div ref={containerRef} className={cn("relative", className)}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "transition-colors",
                    compact
                        ? cn(
                            "rounded-full px-4 py-2 text-sm font-mono font-semibold",
                            "bg-slate-700/80 text-slate-200 hover:bg-slate-600/80",
                            isOpen && "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/30",
                            value ? "text-slate-100" : "text-slate-500"
                        )
                        : cn(
                            "flex h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left text-base",
                            "border-slate-700 bg-slate-950/60 hover:border-slate-600",
                            isOpen && "border-amber-400 ring-1 ring-amber-400/20",
                            value ? "text-slate-100" : "text-slate-500"
                        )
                )}
            >
                <span className="font-mono">{displayValue}</span>
            </button>

            {isOpen && (
                <div className="absolute right-0 top-full z-50 mt-1.5 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl shadow-black/40">
                    <div className="flex divide-x divide-slate-800">
                        <ScrollColumn
                            items={HOURS}
                            selected={hour || "00"}
                            onSelect={handleHourSelect}
                        />
                        <ScrollColumn
                            items={MINUTES}
                            selected={minute || "00"}
                            onSelect={handleMinuteSelect}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
