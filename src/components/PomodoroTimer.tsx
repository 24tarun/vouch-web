"use client";

import { useEffect, useState } from "react";
import { Pause, Play, Square, ChevronDown, ChevronUp, X, Minimize2, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PomoSession } from "@/lib/types";

export interface PomodoroTimerProps {
    session: PomoSession;
    taskTitle: string;
    minimized: boolean;
    onMinimize: () => void;
    onPause: () => void;
    onResume: () => void;
    onStop: () => void;
}

export function PomodoroTimer({ session, taskTitle, minimized, onMinimize, onPause, onResume, onStop }: PomodoroTimerProps) {
    const [timeLeft, setTimeLeft] = useState(0);
    const [progress, setProgress] = useState(0);

    // VFD Color Style
    const vfdColor = "text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.6)]";
    const ringColor = "stroke-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.5)]";

    useEffect(() => {
        const calculateTime = () => {
            if (!session) return;

            const durationSec = session.duration_minutes * 60;
            let currentElapsed = session.elapsed_seconds;

            if (session.status === "ACTIVE") {
                const start = new Date(session.started_at).getTime();
                const now = new Date().getTime();
                currentElapsed += Math.floor((now - start) / 1000);
            }

            const remaining = Math.max(0, durationSec - currentElapsed);
            setTimeLeft(remaining);
            setProgress(Math.min(100, (currentElapsed / durationSec) * 100));
        };

        calculateTime();
        const interval = setInterval(calculateTime, 1000);

        return () => clearInterval(interval);
    }, [session]);

    // Format HH:MM or MM:SS
    const formatTime = (seconds: number) => {
        if (seconds >= 6000) { // > 100 mins
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        }

        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    if (minimized) {
        return (
            <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-10 fade-in duration-300">
                <div
                    onClick={onMinimize}
                    className="group bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-full h-14 pl-2 pr-5 flex items-center gap-3 shadow-2xl cursor-pointer hover:border-cyan-500/30 transition-all overflow-hidden"
                >
                    {/* Tiny Circular Progress */}
                    <div className="relative w-10 h-10 flex items-center justify-center">
                        <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                            <path
                                className="text-slate-800"
                                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="4"
                            />
                            <path
                                className="text-cyan-500 transition-all duration-500 ease-linear"
                                strokeDasharray={`${progress}, 100`}
                                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="4"
                            />
                        </svg>
                        <div className={cn("absolute inset-0 flex items-center justify-center text-[10px] font-bold font-mono", vfdColor)}>
                            {Math.ceil(timeLeft / 60)}
                        </div>
                    </div>

                    <div className="flex flex-col">
                        <span className="text-xs font-medium text-slate-200 truncate max-w-[120px]">{taskTitle}</span>
                        <span className={cn("text-[10px] font-mono tracking-wider", session.status === "PAUSED" ? "text-amber-400" : "text-slate-400")}>
                            {session.status === "PAUSED" ? "PAUSED" : "ACTIVE"}
                        </span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="relative w-full max-w-sm mx-4 bg-[#0a0a0a] border border-slate-800 rounded-3xl p-8 shadow-2xl flex flex-col items-center gap-8 ring-1 ring-white/5">

                {/* Header */}
                <div className="w-full flex justify-between items-start">
                    <div className="space-y-1">
                        <p className="text-xs uppercase tracking-widest text-slate-500 font-semibold">Current Task</p>
                        <h3 className="text-lg font-medium text-white line-clamp-2 leading-tight">{taskTitle}</h3>
                    </div>
                    <button onClick={onMinimize} className="p-2 -mr-2 text-slate-500 hover:text-white transition-colors">
                        <Minimize2 className="w-5 h-5" />
                    </button>
                </div>

                {/* Main Clock */}
                <div className="relative w-64 h-64 flex items-center justify-center">
                    {/* SVG Ring */}
                    <svg className="absolute w-full h-full -rotate-90 drop-shadow-lg" viewBox="0 0 100 100">
                        {/* Track */}
                        <circle
                            cx="50"
                            cy="50"
                            r="45"
                            fill="none"
                            stroke="#1e293b"
                            strokeWidth="3"
                        />
                        {/* Progress */}
                        <circle
                            cx="50"
                            cy="50"
                            r="45"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            className="text-cyan-500 transition-all duration-1000 ease-linear shadow-[0_0_10px_currentColor]"
                            strokeDasharray={`${progress * 2.83}, 283`} // 2 * PI * 45 ≈ 283
                        />
                    </svg>

                    {/* VFD Display */}
                    <div className="flex flex-col items-center gap-2 z-10">
                        <div className={cn("text-6xl font-mono font-bold tracking-tight py-2 px-4 bg-black/50 rounded-lg border border-cyan-900/30 shadow-[inset_0_0_20px_rgba(6,182,212,0.1)]", vfdColor)}>
                            {formatTime(timeLeft)}
                        </div>
                        <span className={cn("text-xs font-bold tracking-[0.2em] uppercase", session.status === "PAUSED" ? "text-amber-400 animate-pulse" : "text-cyan-700")}>
                            {session.status === "PAUSED" ? "PAUSED" : "FOCUSING"}
                        </span>
                    </div>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-6 w-full justify-center">
                    {session.status === "ACTIVE" ? (
                        <button
                            onClick={onPause}
                            className="w-16 h-16 rounded-full bg-slate-900 border border-slate-700 text-slate-200 flex items-center justify-center hover:bg-slate-800 hover:border-slate-600 transition-all hover:scale-105 active:scale-95"
                        >
                            <Pause className="w-6 h-6 fill-current" />
                        </button>
                    ) : (
                        <button
                            onClick={onResume}
                            className="w-16 h-16 rounded-full bg-slate-900 border border-slate-700 text-slate-200 flex items-center justify-center hover:bg-slate-800 hover:border-slate-600 transition-all hover:scale-105 active:scale-95"
                        >
                            <Play className="w-6 h-6 fill-current pl-1" />
                        </button>
                    )}

                    <button
                        onClick={() => {
                            if (confirm("Are you sure you want to stop this session?")) {
                                onStop();
                            }
                        }}
                        className="w-16 h-16 rounded-full bg-red-950/30 border border-red-900/50 text-red-500 flex items-center justify-center hover:bg-red-900/30 hover:border-red-500/50 transition-all hover:scale-105 active:scale-95 group"
                    >
                        <Square className="w-5 h-5 fill-current" />
                    </button>
                </div>
            </div>
        </div>
    );
}
