"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { usePomodoro } from "@/components/PomodoroProvider";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { DEFAULT_POMO_DURATION_MINUTES } from "@/lib/constants";

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
    const { startSession, session } = usePomodoro();
    const normalizedDefaultDuration =
        Number.isInteger(defaultDurationMinutes) &&
        defaultDurationMinutes >= 1 &&
        defaultDurationMinutes <= 720
            ? defaultDurationMinutes
            : DEFAULT_POMO_DURATION_MINUTES;
    const [durationInput, setDurationInput] = useState(String(normalizedDefaultDuration));
    const isActive = session?.task_id === taskId && session?.status === "ACTIVE";

    useEffect(() => {
        setDurationInput(String(normalizedDefaultDuration));
    }, [normalizedDefaultDuration]);

    const handleStart = async () => {
        const minutes = Number(durationInput);
        const isValid =
            Number.isFinite(minutes) &&
            Number.isInteger(minutes) &&
            minutes >= 1 &&
            minutes <= 720;

        if (!isValid) {
            toast.error("Enter a valid duration in minutes (1-720).");
            return;
        }

        await startSession(taskId, minutes);
    };

    if (isActive) {
        return (
            <div className={cn("text-cyan-400 animate-pulse flex items-center gap-2", className)}>
                <Timer className="w-4 h-4" />
                {variant === "full" && <span className="text-xs font-mono">Running</span>}
            </div>
        );
    }

    if (variant === "full") {
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
                    className="h-full px-3 text-cyan-400 hover:text-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.6)] transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Start Focus Session"
                >
                    <Timer className="w-4 h-4" />
                </button>
                <div className="h-5 w-px bg-cyan-500/30" />
                <input
                    type="number"
                    min="1"
                    max="720"
                    step="1"
                    value={durationInput}
                    onChange={(e) => setDurationInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            handleStart();
                        }
                    }}
                    className="h-full w-16 px-2 bg-transparent text-cyan-300 text-xs font-mono focus:outline-none text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    aria-label="Pomodoro duration in minutes"
                />
            </div>
        );
    }

    return (
        <button
            type="button"
            onClick={() => startSession(taskId, normalizedDefaultDuration)}
            className={cn(
                "text-slate-500 hover:text-cyan-400 transition-colors flex items-center gap-2",
                className
            )}
            title={`Start ${normalizedDefaultDuration} minute focus session`}
        >
            <Timer className="w-4 h-4" />
        </button>
    );
}
