"use client";

import { useState } from "react";
import { Timer } from "lucide-react";
import { usePomodoro } from "@/components/PomodoroProvider";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface PomoButtonProps {
    taskId: string;
    className?: string;
    variant?: "icon" | "full";
}

export function PomoButton({ taskId, className, variant = "icon" }: PomoButtonProps) {
    const { startSession, session } = usePomodoro();
    const [durationInput, setDurationInput] = useState("25");
    const isActive = session?.task_id === taskId && session?.status === "ACTIVE";

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
            <div className={cn("flex items-center gap-2", className)}>
                <div className="relative w-16 shrink-0">
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
                        className="h-9 w-full px-2 bg-slate-800/40 hover:bg-slate-700/40 border border-slate-700/40 rounded-lg text-slate-200 text-xs font-mono focus:outline-none focus:border-slate-500 transition-all text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        aria-label="Pomodoro duration in minutes"
                    />
                </div>
                <button
                    type="button"
                    onClick={handleStart}
                    className="h-9 w-9 shrink-0 bg-slate-800/40 hover:bg-slate-700/40 border border-slate-700/40 text-cyan-300 hover:text-cyan-200 rounded-lg transition-all flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Start Focus Session"
                >
                    <Timer className="w-4 h-4" />
                </button>
            </div>
        );
    }

    return (
        <button
            type="button"
            onClick={() => startSession(taskId, 25)}
            className={cn(
                "text-slate-500 hover:text-cyan-400 transition-colors flex items-center gap-2",
                className
            )}
            title="Start 25 minute focus session"
        >
            <Timer className="w-4 h-4" />
        </button>
    );
}
