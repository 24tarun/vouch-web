"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
    startPomoSession,
    pausePomoSession,
    resumePomoSession,
    endPomoSession,
    getActivePomoSession
} from "@/actions/tasks";
import { PomoSession } from "@/lib/types";
import { PomodoroTimer } from "@/components/PomodoroTimer";

interface PomodoroContextType {
    session: PomoSession | null;
    taskTitle: string | null;
    isLoading: boolean;
    startSession: (taskId: string, durationMinutes: number) => Promise<void>;
    pauseSession: () => Promise<void>;
    resumeSession: () => Promise<void>;
    stopSession: () => Promise<void>;
    minimized: boolean;
    setMinimized: (v: boolean) => void;
    suppressUnloadWarning: () => void;
}

const PomodoroContext = createContext<PomodoroContextType | undefined>(undefined);

export function usePomodoro() {
    const context = useContext(PomodoroContext);
    if (!context) {
        throw new Error("usePomodoro must be used within a PomodoroProvider");
    }
    return context;
}

export function PomodoroProvider({ children }: { children: ReactNode }) {
    const router = useRouter();
    const [session, setSession] = useState<PomoSession | null>(null);
    const [taskTitle, setTaskTitle] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [minimized, setMinimized] = useState(false);
    const unloadSignalSentRef = useRef(false);
    const suppressBeforeUnloadRef = useRef(false);

    const refreshSession = useCallback(async () => {
        try {
            const data = await getActivePomoSession();
            // @ts-ignore
            if (data) {
                // @ts-ignore
                setSession(data);
                // @ts-ignore
                setTaskTitle(data.task?.title || "Unknown Task");
            } else {
                setSession(null);
                setTaskTitle(null);
            }
        } catch (error) {
            console.error("Failed to fetch pomo session", error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        refreshSession();

        // Poll every minute just to sync status in case of external changes? 
        // Or refrain to save resources. 
        // For now, relies on user actions triggering updates.
    }, [refreshSession]);

    useEffect(() => {
        unloadSignalSentRef.current = false;
        if (session?.status !== "ACTIVE") {
            suppressBeforeUnloadRef.current = false;
        }
    }, [session?.id, session?.status]);

    // Warn on close if active, and auto-end session if user force-leaves.
    useEffect(() => {
        const tryAutoEndOnUnload = () => {
            if (!session || session.status !== "ACTIVE") return;
            if (unloadSignalSentRef.current) return;
            unloadSignalSentRef.current = true;

            const payload = JSON.stringify({ sessionId: session.id });
            const blob = new Blob([payload], { type: "application/json" });

            let queued = false;
            if (typeof navigator !== "undefined" && navigator.sendBeacon) {
                queued = navigator.sendBeacon("/api/pomo/auto-end", blob);
            }

            if (!queued) {
                void fetch("/api/pomo/auto-end", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: payload,
                    keepalive: true,
                });
            }
        };

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (suppressBeforeUnloadRef.current) return;
            if (session && session.status === "ACTIVE") {
                e.preventDefault();
                e.returnValue = ""; // Legacy
                return "You have an active Pomodoro session. It will be stopped if you leave.";
            }
        };

        const handlePageHide = () => {
            tryAutoEndOnUnload();
        };

        const handleUnload = () => {
            tryAutoEndOnUnload();
        };

        window.addEventListener("beforeunload", handleBeforeUnload);
        window.addEventListener("pagehide", handlePageHide);
        window.addEventListener("unload", handleUnload);
        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload);
            window.removeEventListener("pagehide", handlePageHide);
            window.removeEventListener("unload", handleUnload);
        };
    }, [session]);

    const startSession = async (taskId: string, durationMinutes: number) => {
        setIsLoading(true);
        // Check for ANY active or paused session
        if (session) {
            if (session.task_id === taskId) {
                const endRes = await endPomoSession(session.id);
                if (endRes.error) {
                    toast.error(endRes.error);
                    setMinimized(false);
                    setIsLoading(false);
                    return;
                }
                await refreshSession();
            } else {
                setMinimized(false);
                setIsLoading(false);
                return;
            }
        }

        const res = await startPomoSession(taskId, durationMinutes);
        if (res.error) {
            const conflict = res.error.toLowerCase().includes("active session");
            if (conflict) {
                await refreshSession();
                setMinimized(false);
            } else {
                toast.error(res.error);
            }
        } else {
            await refreshSession();
            setMinimized(false); // Open timer
        }
        setIsLoading(false);
    };

    const pauseSession = async () => {
        if (!session) return;
        // Optimistic
        const prev = session;
        setSession({ ...prev, status: "PAUSED", paused_at: new Date().toISOString() });

        const res = await pausePomoSession(session.id);
        if (res.error) {
            toast.error(res.error);
            setSession(prev); // Revert
        } else {
            refreshSession();
        }
    };

    const resumeSession = async () => {
        if (!session) return;
        const prev = session;
        setSession({ ...prev, status: "ACTIVE", paused_at: null, started_at: new Date().toISOString() });

        const res = await resumePomoSession(session.id);
        if (res.error) {
            toast.error(res.error);
            setSession(prev);
        } else {
            refreshSession();
        }
    };

    const stopSession = async () => {
        if (!session) return;
        const res = await endPomoSession(session.id);
        if (res.error) {
            toast.error(res.error);
        } else {
            toast.success("Pomodoro session logged!");
            await refreshSession(); // Should clear session
            router.refresh();
        }
    };

    const suppressUnloadWarning = () => {
        suppressBeforeUnloadRef.current = true;
    };

    return (
        <PomodoroContext.Provider value={{
            session,
            taskTitle,
            isLoading,
            startSession,
            pauseSession,
            resumeSession,
            stopSession,
            minimized,
            setMinimized,
            suppressUnloadWarning
        }}>
            {children}
            {session && (
                <PomodoroTimer
                    session={session}
                    taskTitle={taskTitle || "Focus"}
                    minimized={minimized}
                    onMinimize={() => setMinimized(!minimized)}
                    onPause={pauseSession}
                    onResume={resumeSession}
                    onStop={stopSession}
                />
            )}
        </PomodoroContext.Provider>
    );
}
