"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
    startPomoSession,
    pausePomoSession,
    resumePomoSession,
    endPomoSession,
    getActivePomoSession
} from "@/actions/tasks";
import { PomoSession } from "@/lib/types";
import { PomodoroTimer } from "@/components/PomodoroTimer";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";

type PomoEndSource = "manual_stop" | "timer_completed" | "system";
type PomoSessionWithTask = PomoSession & { task?: { title?: string | null } | null };
type ActivePomoSessionResponse = {
    session: PomoSessionWithTask | null;
    serverNow: string;
};

interface PomodoroContextType {
    session: PomoSession | null;
    taskTitle: string | null;
    isLoading: boolean;
    startSession: (taskId: string, durationMinutes: number) => Promise<void>;
    pauseSession: () => Promise<void>;
    resumeSession: () => Promise<void>;
    stopSession: (source?: PomoEndSource) => Promise<void>;
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
    const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);
    const unloadSignalSentRef = useRef(false);
    const suppressBeforeUnloadRef = useRef(false);
    const supabaseRef = useRef(createSupabaseClient());
    const pomoChannelRef = useRef<RealtimeChannel | null>(null);

    const clearPomoChannel = useCallback(() => {
        const channel = pomoChannelRef.current;
        if (!channel) return;
        void supabaseRef.current.removeChannel(channel);
        pomoChannelRef.current = null;
    }, []);

    const refreshSession = useCallback(async () => {
        const requestStartedAtMs = Date.now();
        try {
            const data = await getActivePomoSession() as ActivePomoSessionResponse;
            const responseReceivedAtMs = Date.now();

            const serverNowMs = new Date(data.serverNow).getTime();
            if (!Number.isNaN(serverNowMs)) {
                const roundTripMs = responseReceivedAtMs - requestStartedAtMs;
                const midpointClientMs = requestStartedAtMs + Math.floor(roundTripMs / 2);
                setServerClockOffsetMs(serverNowMs - midpointClientMs);
            }

            const sessionData = data.session;
            if (sessionData) {
                setSession(sessionData);
                setTaskTitle(sessionData.task?.title || "Unknown Task");
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
        let mounted = true;
        const supabase = supabaseRef.current;

        const subscribeToPomoSessions = (userId: string) => {
            clearPomoChannel();
            const channel = supabase
                .channel(`realtime:pomo_sessions:${userId}`)
                .on(
                    "postgres_changes",
                    {
                        event: "*",
                        schema: "public",
                        table: "pomo_sessions",
                        filter: `user_id=eq.${userId}`,
                    },
                    () => {
                        void refreshSession();
                    }
                )
                .subscribe((status) => {
                    if (status === "SUBSCRIBED") {
                        void refreshSession();
                    }
                });
            pomoChannelRef.current = channel;
        };

        const initialize = async () => {
            await refreshSession();
            const {
                data: { user },
            } = await supabase.auth.getUser();
            if (!mounted) return;
            if (user?.id) {
                subscribeToPomoSessions(user.id);
            }
        };

        void initialize();

        const {
            data: { subscription: authSubscription },
        } = supabase.auth.onAuthStateChange((_event, authSession) => {
            if (authSession?.user?.id) {
                subscribeToPomoSessions(authSession.user.id);
                void refreshSession();
            } else {
                clearPomoChannel();
                setSession(null);
                setTaskTitle(null);
            }
        });

        return () => {
            mounted = false;
            authSubscription.unsubscribe();
            clearPomoChannel();
        };
    }, [clearPomoChannel, refreshSession]);

    useEffect(() => {
        const handleFocus = () => {
            void refreshSession();
        };
        const handleVisibility = () => {
            if (document.visibilityState === "visible") {
                void refreshSession();
            }
        };

        window.addEventListener("focus", handleFocus);
        document.addEventListener("visibilitychange", handleVisibility);
        return () => {
            window.removeEventListener("focus", handleFocus);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, [refreshSession]);

    useEffect(() => {
        if (!session) return;

        const interval = window.setInterval(() => {
            void refreshSession();
        }, 15_000);

        return () => window.clearInterval(interval);
    }, [session, refreshSession]);

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

        window.addEventListener("beforeunload", handleBeforeUnload);
        window.addEventListener("pagehide", handlePageHide);
        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload);
            window.removeEventListener("pagehide", handlePageHide);
        };
    }, [session]);

    const startSession = async (taskId: string, durationMinutes: number) => {
        // Guard invalid concurrent starts locally for snappy feedback.
        if (session && (session.status === "ACTIVE" || session.status === "PAUSED")) {
            if (session.task_id !== taskId) {
                toast.error("One Pomodoro session at a time. Stop the current session first.");
            }
            setMinimized(false);
            return;
        }

        setIsLoading(true);
        const res = await startPomoSession(taskId, durationMinutes);
        if (res.error) {
            const conflict = res.error.toLowerCase().includes("active session");
            if (conflict) {
                toast.error("One Pomodoro session at a time. Stop the current session first.");
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
        const res = await pausePomoSession(session.id);
        if (res.error) {
            toast.error(res.error);
        } else {
            await refreshSession();
        }
    };

    const resumeSession = async () => {
        if (!session) return;
        const res = await resumePomoSession(session.id);
        if (res.error) {
            toast.error(res.error);
        } else {
            await refreshSession();
        }
    };

    const stopSession = async (source: PomoEndSource = "manual_stop") => {
        if (!session) return;
        const res = await endPomoSession(session.id, source);
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
                    serverClockOffsetMs={serverClockOffsetMs}
                    onMinimize={() => setMinimized(!minimized)}
                    onPause={pauseSession}
                    onResume={resumeSession}
                    onStop={stopSession}
                />
            )}
        </PomodoroContext.Provider>
    );
}
