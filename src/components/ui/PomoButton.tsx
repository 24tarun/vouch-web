"use client";

import { useEffect, useState } from "react";
// import { Timer } from "lucide-react"; // kept for easy revert
import { TomatoPixelIcon } from "@/components/TomatoPixelIcon";
import { usePomodoro } from "@/components/PomodoroProvider";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
    DEFAULT_POMO_DURATION_MINUTES,
    MAX_POMO_DURATION_MINUTES,
} from "@/lib/constants";
import { isValidPomoDurationMinutes, normalizePomoDurationMinutes } from "@/lib/pomodoro";

interface PomoButtonProps {
    taskId: string;
    className?: string;
    variant?: "icon" | "full";
    defaultDurationMinutes?: number;
}

export function PomoButton({
    taskId,
    className,
    variant = "icon",
    defaultDurationMinutes = DEFAULT_POMO_DURATION_MINUTES,
}: PomoButtonProps) {
    const { startSession, session, isLoading } = usePomodoro();
    const normalizedDefaultDuration = normalizePomoDurationMinutes(defaultDurationMinutes);
    const [durationInput, setDurationInput] = useState(String(normalizedDefaultDuration));
    const isActive = session?.task_id === taskId && session?.status === "ACTIVE";
    const iconButtonClass = "inline-flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

    useEffect(() => {
        setDurationInput(String(normalizedDefaultDuration));
    }, [normalizedDefaultDuration]);

    const handleStart = async () => {
        if (isLoading) return;

        if (session && session.task_id !== taskId) {
            toast.error("One Pomodoro session at a time. Stop the current session first.");
            return;
        }

        const minutes = Number(durationInput);
        if (!isValidPomoDurationMinutes(minutes)) {
            toast.error(`Enter a valid duration in minutes (1-${MAX_POMO_DURATION_MINUTES}).`);
            return;
        }

        await startSession(taskId, minutes);
    };

    if (variant === "full") {
        if (isActive) {
            return (
                <div className={cn("text-cyan-400 animate-pulse flex items-center gap-2", className)}>
                    {/* <Timer className="w-4 h-4" /> */}
                    <TomatoPixelIcon size={24} speed={2.2} glow={1.2} />
                    <span className="text-xs font-mono">Running</span>
                </div>
            );
        }

        return (
            <div
                className={cn(
                    "h-9 rounded-lg border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 transition-all flex items-center overflow-hidden",
                    className
                )}
            >
                <button
                    type="button"
                    onClick={handleStart}
                    disabled={isLoading}
                    className="h-full px-3 text-cyan-400 hover:text-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.6)] transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Start Focus Session"
                >
                    {/* <Timer className="w-4 h-4" /> */}
                    <TomatoPixelIcon size={24} speed={1.5} glow={0.8} />
                </button>
                <div className="h-5 w-px bg-cyan-500/30" />
                <input
                    type="number"
                    min="1"
                    max={String(MAX_POMO_DURATION_MINUTES)}
                    step="1"
                    inputMode="numeric"
                    value={durationInput}
                    onChange={(e) => setDurationInput(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    onClick={(e) => e.currentTarget.select()}
                    disabled={isLoading}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            handleStart();
                        }
                    }}
                    className="h-full w-20 px-2 bg-transparent text-cyan-300 text-xs font-mono text-center cursor-text focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    aria-label="Pomodoro duration in minutes"
                />
            </div>
        );
    }

    return (
        <button
            type="button"
            disabled={isLoading}
            onClick={() => {
                if (isActive) return;
                void startSession(taskId, normalizedDefaultDuration);
            }}
            className={cn(
                iconButtonClass,
                isActive
                    ? "text-cyan-400 animate-pulse drop-shadow-[0_0_8px_rgba(34,211,238,0.6)] hover:text-cyan-300 hover:drop-shadow-[0_0_12px_rgba(34,211,238,0.75)]"
                    : "text-slate-500 hover:text-cyan-400",
                className
            )}
            title={isActive ? "Pomodoro running" : `Start ${normalizedDefaultDuration} minute focus session`}
            aria-label={isActive ? "Pomodoro running" : "Start pomodoro"}
        >
            {/* <Timer className="w-4 h-4" /> */}
            <TomatoPixelIcon size={24} speed={isActive ? 2.2 : 1.0} glow={isActive ? 1.8 : 1.0} />
        </button>
    );
}
