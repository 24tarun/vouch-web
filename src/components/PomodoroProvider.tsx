"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
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

    // Warn on close if active
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (session && session.status === "ACTIVE") {
                e.preventDefault();
                e.returnValue = ""; // Legacy
                return "You have an active Pomodoro session. It will be stopped if you leave.";
            }
        };

        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, [session]);

    const startSession = async (taskId: string, durationMinutes: number) => {
        setIsLoading(true);
        // Check for ANY active or paused session
        if (session) {
            toast("Active Session Conflict", {
                description: `A pomo from "${taskTitle || "another task"}" is active. Please end it before starting another.`,
                action: {
                    label: "End & Switch",
                    onClick: async () => {
                        await stopSession();
                        // Wait a tick for state to settle or just force start
                        const res = await startPomoSession(taskId, durationMinutes);
                        if (res.error) toast.error(res.error);
                        else {
                            await refreshSession();
                            setMinimized(false);
                            toast.success("Switched to new session");
                        }
                    }
                }
            });
            setIsLoading(false);
            return;
        }

        const res = await startPomoSession(taskId, durationMinutes);
        if (res.error) {
            toast.error(res.error);
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
            setMinimized
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
