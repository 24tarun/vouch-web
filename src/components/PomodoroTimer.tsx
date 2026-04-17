"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Square, Minimize2, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PomoSession } from "@/lib/types";

export interface PomodoroTimerProps {
    session: PomoSession;
    taskTitle: string;
    minimized: boolean;
    serverClockOffsetMs: number;
    onMinimize: () => void;
    onPause: () => void;
    onResume: () => void;
    onStop: (source?: "manual_stop" | "timer_completed" | "system") => void;
}

function getSessionTiming(session: PomoSession, nowMs: number) {
    const durationSec = session.duration_minutes * 60;
    let currentElapsed = session.elapsed_seconds;

    if (session.status === "ACTIVE") {
        const start = new Date(session.started_at).getTime();
        currentElapsed += Math.max(0, Math.floor((nowMs - start) / 1000));
    }

    const remaining = Math.max(0, durationSec - currentElapsed);
    const progress = durationSec > 0 ? Math.min(100, (currentElapsed / durationSec) * 100) : 100;
    return { remaining, progress };
}

const DIGIT_SEGMENTS: Record<string, [boolean, boolean, boolean, boolean, boolean, boolean, boolean]> = {
    "0": [true, true, true, true, true, true, false],
    "1": [false, true, true, false, false, false, false],
    "2": [true, true, false, true, true, false, true],
    "3": [true, true, true, true, false, false, true],
    "4": [false, true, true, false, false, true, true],
    "5": [true, false, true, true, false, true, true],
    "6": [true, false, true, true, true, true, true],
    "7": [true, true, true, false, false, false, false],
    "8": [true, true, true, true, true, true, true],
    "9": [true, true, true, true, false, true, true],
};

function SevenSegmentDigit({ digit }: { digit: string }) {
    const segments = DIGIT_SEGMENTS[digit] || DIGIT_SEGMENTS["0"];
    return (
        <span className="seven-seg-digit" aria-hidden="true">
            <span className={cn("seven-seg-segment seven-seg-a", segments[0] && "seven-seg-on")} />
            <span className={cn("seven-seg-segment seven-seg-b", segments[1] && "seven-seg-on")} />
            <span className={cn("seven-seg-segment seven-seg-c", segments[2] && "seven-seg-on")} />
            <span className={cn("seven-seg-segment seven-seg-d", segments[3] && "seven-seg-on")} />
            <span className={cn("seven-seg-segment seven-seg-e", segments[4] && "seven-seg-on")} />
            <span className={cn("seven-seg-segment seven-seg-f", segments[5] && "seven-seg-on")} />
            <span className={cn("seven-seg-segment seven-seg-g", segments[6] && "seven-seg-on")} />
        </span>
    );
}

function SevenSegmentColon() {
    return (
        <span className="seven-seg-colon" aria-hidden="true">
            <span className="seven-seg-colon-dot seven-seg-on" />
            <span className="seven-seg-colon-dot seven-seg-on" />
        </span>
    );
}

export function PomodoroTimer({ session, taskTitle, minimized, serverClockOffsetMs, onMinimize, onPause, onResume, onStop }: PomodoroTimerProps) {
    const durationSec = session.duration_minutes * 60;
    const initialRemaining = Math.max(0, durationSec - session.elapsed_seconds);
    const initialProgress = durationSec > 0 ? Math.min(100, (session.elapsed_seconds / durationSec) * 100) : 100;
    const [timeLeft, setTimeLeft] = useState(initialRemaining);
    const [progress, setProgress] = useState(initialProgress);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const autoStopTriggeredRef = useRef(false);

    // VFD Color Style
    const vfdColor = "text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.6)]";

    useEffect(() => {
        const calculateTime = () => {
            if (!session) return;
            const timing = getSessionTiming(session, Date.now() + serverClockOffsetMs);
            setTimeLeft(timing.remaining);
            setProgress(timing.progress);
        };

        calculateTime();
        const interval = setInterval(calculateTime, 1000);

        return () => clearInterval(interval);
    }, [session, serverClockOffsetMs]);

    useEffect(() => {
        autoStopTriggeredRef.current = false;
    }, [session.id]);

    useEffect(() => {
        if (session.status !== "ACTIVE") return;
        if (timeLeft > 0) return;
        if (progress < 100) return;
        if (autoStopTriggeredRef.current) return;

        autoStopTriggeredRef.current = true;
        onStop("timer_completed");
    }, [session.status, timeLeft, progress, onStop]);

    useEffect(() => {
        const onFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };

        document.addEventListener("fullscreenchange", onFullscreenChange);
        return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
    }, []);

    useEffect(() => {
        if (!isFullscreen) return;

        const prevBodyOverflow = document.body.style.overflow;
        const prevHtmlOverflow = document.documentElement.style.overflow;

        document.body.style.overflow = "hidden";
        document.documentElement.style.overflow = "hidden";

        return () => {
            document.body.style.overflow = prevBodyOverflow;
            document.documentElement.style.overflow = prevHtmlOverflow;
        };
    }, [isFullscreen]);

    const isLongSession = session.duration_minutes >= 100;

    // Format HH:MM:SS for long sessions, MM:SS otherwise
    const formatTime = (seconds: number) => {
        if (isLongSession) {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = seconds % 60;
            return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
        }

        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    };

    const toggleFullscreen = async () => {
        try {
            if (!document.fullscreenElement) {
                await document.documentElement.requestFullscreen();
                setIsFullscreen(true);
            } else {
                await document.exitFullscreen();
                setIsFullscreen(false);
            }
        } catch {
            // Ignore API failures. The overlay still covers the viewport.
        }
    };

    const formattedTime = formatTime(timeLeft);

    if (minimized) {
        return (
            <div className="fixed z-50 animate-in slide-in-from-bottom-10 fade-in duration-300 [left:calc(env(safe-area-inset-left)+1rem)] [bottom:calc(env(safe-area-inset-bottom)+1rem)]">
                <div
                    onClick={onMinimize}
                    className="group bg-black border border-slate-800 rounded-full h-20 pl-3 pr-6 flex items-center gap-4 shadow-2xl cursor-pointer hover:border-cyan-500/40 transition-all overflow-hidden min-w-[230px]"
                >
                    {/* Tiny Circular Progress */}
                    <div className="relative w-14 h-14 flex items-center justify-center">
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
                        <div className={cn("absolute inset-0 flex items-center justify-center text-xs font-bold font-mono", vfdColor)}>
                            {isLongSession
                                ? `${Math.floor(timeLeft / 3600)}h${Math.floor((timeLeft % 3600) / 60)}m`
                                : Math.ceil(timeLeft / 60)}
                        </div>
                    </div>

                    <div className="flex flex-col">
                        <span className="text-sm font-medium text-slate-200 truncate max-w-[150px]">{taskTitle}</span>
                        <span className={cn("text-xs font-mono tracking-wider", session.status === "PAUSED" ? "text-amber-400" : "text-slate-400")}>
                            {session.status === "PAUSED" ? "PAUSED" : "ACTIVE"}
                        </span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 bg-black text-slate-200 animate-in fade-in duration-200">
            <div className="absolute left-6 top-[calc(env(safe-area-inset-top)+1rem)]">
                <h3 className="text-xl font-semibold text-white max-w-[70vw] truncate">{taskTitle}</h3>
            </div>

            <div className="absolute right-6 top-[calc(env(safe-area-inset-top)+1rem)] flex items-center gap-1">
                <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="p-2 text-slate-500 hover:text-cyan-300 transition-colors"
                    title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                >
                    <Maximize2 className="w-5 h-5" />
                </button>
                <button
                    type="button"
                    onClick={onMinimize}
                    className="p-2 text-slate-500 hover:text-white transition-colors"
                    title="Minimize timer"
                >
                    <Minimize2 className="w-5 h-5" />
                </button>
            </div>

            <div className="h-full w-full flex flex-col items-center justify-center gap-10 px-4">
                {/* Main Clock */}
                <div className="relative min-h-[170px] flex items-center justify-center">
                    {/* VFD Display */}
                    <div className={cn("seven-seg-display z-10", isLongSession && "seven-seg-display-long", vfdColor)} aria-label={`Time remaining ${formattedTime}`}>
                        {formattedTime.split("").map((char, i) =>
                            char === ":" ? <SevenSegmentColon key={`colon-${i}`} /> : <SevenSegmentDigit key={`digit-${i}-${char}`} digit={char} />
                        )}
                    </div>
                </div>

                {/* Controls */}
                <div className="flex items-center w-full justify-center gap-10">
                    {session.status === "ACTIVE" ? (
                        <button
                            onClick={onPause}
                            className="text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.45)] hover:text-cyan-300 hover:drop-shadow-[0_0_12px_rgba(34,211,238,0.6)] transition-all hover:scale-105 active:scale-95 p-2"
                            title="Pause"
                        >
                            <Pause className="w-10 h-10 fill-current" />
                        </button>
                    ) : (
                        <button
                            onClick={onResume}
                            className="text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.45)] hover:text-cyan-300 hover:drop-shadow-[0_0_12px_rgba(34,211,238,0.6)] transition-all hover:scale-105 active:scale-95 p-2"
                            title="Resume"
                        >
                            <Play className="w-10 h-10 fill-current" />
                        </button>
                    )}

                    <button
                        onClick={() => {
                            if (confirm("Are you sure you want to stop this session?")) {
                                onStop("manual_stop");
                            }
                        }}
                        className="text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.45)] hover:text-cyan-300 hover:drop-shadow-[0_0_12px_rgba(34,211,238,0.6)] transition-all hover:scale-105 active:scale-95 p-2"
                        title="Stop"
                    >
                        <Square className="w-9 h-9 fill-current" />
                    </button>
                </div>
            </div>
        </div>
    );
}
