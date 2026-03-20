"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import {
    emitRealtimeCommitmentChange,
    type RealtimeCommitmentChange,
    type RealtimeCommitmentEventType,
    type RealtimeCommitmentRow,
    emitRealtimeTaskChange,
    type RealtimeTaskChange,
    type RealtimeTaskEventType,
    type RealtimeTaskRow,
} from "@/lib/realtime-task-events";

const ENABLE_REALTIME_DEBUG_LOGS = process.env.NODE_ENV !== "production";
const FAST_REFRESH_THROTTLE_MS = 300;
const RECONCILIATION_REFRESH_MS = 1200;

function isTaskPatchEnabledPath(pathname: string | null): boolean {
    if (!pathname) return false;
    return (
        pathname === "/dashboard" ||
        pathname.startsWith("/dashboard/commitments") ||
        pathname.startsWith("/dashboard/tasks/") ||
        pathname.startsWith("/dashboard/voucher") ||
        pathname.startsWith("/dashboard/friends")
    );
}

function toRealtimeTaskEventType(value: unknown): RealtimeTaskEventType | null {
    if (typeof value !== "string") return null;
    const normalized = value.toUpperCase();
    if (normalized === "INSERT" || normalized === "UPDATE" || normalized === "DELETE") {
        return normalized;
    }
    return null;
}

function toRealtimeTaskRow(value: unknown): RealtimeTaskRow | null {
    if (!value || typeof value !== "object") return null;
    const row = value as Partial<RealtimeTaskRow>;
    if (
        typeof row.id !== "string" ||
        typeof row.user_id !== "string" ||
        typeof row.voucher_id !== "string" ||
        typeof row.status !== "string" ||
        typeof row.updated_at !== "string"
    ) {
        return null;
    }

    return row as RealtimeTaskRow;
}

function toRealtimeCommitmentEventType(value: unknown): RealtimeCommitmentEventType | null {
    if (typeof value !== "string") return null;
    const normalized = value.toUpperCase();
    if (normalized === "INSERT" || normalized === "UPDATE" || normalized === "DELETE") {
        return normalized;
    }
    return null;
}

function toRealtimeCommitmentRow(value: unknown): RealtimeCommitmentRow | null {
    if (!value || typeof value !== "object") return null;
    const row = value as Partial<RealtimeCommitmentRow>;
    if (
        typeof row.id !== "string" ||
        typeof row.user_id !== "string" ||
        typeof row.name !== "string" ||
        typeof row.status !== "string" ||
        typeof row.start_date !== "string" ||
        typeof row.end_date !== "string" ||
        typeof row.updated_at !== "string"
    ) {
        return null;
    }

    return row as RealtimeCommitmentRow;
}

interface GoogleCalendarOutboxRow {
    id: number;
    user_id: string;
    task_id: string | null;
    intent: string;
    status: string;
    last_error: string | null;
}

function toGoogleCalendarOutboxRow(value: unknown): GoogleCalendarOutboxRow | null {
    if (!value || typeof value !== "object") return null;

    const row = value as Partial<GoogleCalendarOutboxRow> & { id?: number | string };
    const idNumber = typeof row.id === "number" ? row.id : Number(row.id);
    if (!Number.isFinite(idNumber)) return null;
    if (typeof row.user_id !== "string") return null;
    if (typeof row.intent !== "string") return null;
    if (typeof row.status !== "string") return null;
    if (row.task_id != null && typeof row.task_id !== "string") return null;
    if (row.last_error != null && typeof row.last_error !== "string") return null;

    return {
        id: idNumber,
        user_id: row.user_id,
        task_id: row.task_id ?? null,
        intent: row.intent,
        status: row.status,
        last_error: row.last_error ?? null,
    };
}

export function RealtimeListener({ userId }: { userId: string }) {
    const router = useRouter();
    const pathname = usePathname();
    const supabaseRef = useRef(createClient());
    const refreshTimeoutRef = useRef<number | null>(null);
    const nextRefreshAtRef = useRef(0);
    const lastRefreshAtRef = useRef(0);
    const friendIdsRef = useRef<Set<string>>(new Set());
    const seenGoogleOutboxStateRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!userId) return;
        const supabase = supabaseRef.current;
        let isActive = true;
        const patchEnabledForPath = isTaskPatchEnabledPath(pathname);

        const syncFriendIds = async () => {
            const { data, error } = await supabase
                .from("friendships")
                .select("friend_id")
                .eq("user_id", userId);

            if (!isActive || error) return;

            const nextFriendIds = new Set<string>();
            for (const row of ((data as Array<{ friend_id?: string }> | null) || [])) {
                if (row?.friend_id) nextFriendIds.add(row.friend_id);
            }
            friendIdsRef.current = nextFriendIds;
        };

        const scheduleRefresh = (mode: "fast" | "reconcile" = "fast") => {
            const throttleMs = mode === "reconcile" ? RECONCILIATION_REFRESH_MS : FAST_REFRESH_THROTTLE_MS;
            const now = Date.now();
            const elapsed = now - lastRefreshAtRef.current;
            const delayMs = Math.max(0, throttleMs - elapsed);
            const nextRefreshAt = now + delayMs;

            if (refreshTimeoutRef.current && nextRefreshAt >= nextRefreshAtRef.current) {
                return;
            }

            if (refreshTimeoutRef.current) {
                window.clearTimeout(refreshTimeoutRef.current);
                refreshTimeoutRef.current = null;
            }

            nextRefreshAtRef.current = nextRefreshAt;
            refreshTimeoutRef.current = window.setTimeout(() => {
                lastRefreshAtRef.current = Date.now();
                refreshTimeoutRef.current = null;
                nextRefreshAtRef.current = 0;
                router.refresh();
            }, Math.max(0, nextRefreshAt - Date.now()));
        };

        const emitTaskChange = (
            payload: { eventType?: unknown; new?: unknown; old?: unknown }
        ): RealtimeTaskEventType | null => {
            const eventType = toRealtimeTaskEventType(payload.eventType);
            if (!eventType) return null;

            const change: RealtimeTaskChange = {
                eventType,
                newRow: toRealtimeTaskRow(payload.new),
                oldRow: toRealtimeTaskRow(payload.old),
                receivedAt: Date.now(),
            };
            emitRealtimeTaskChange(change);
            return eventType;
        };

        const emitCommitmentChange = (
            payload: { eventType?: unknown; new?: unknown; old?: unknown }
        ): RealtimeCommitmentEventType | null => {
            const eventType = toRealtimeCommitmentEventType(payload.eventType);
            if (!eventType) return null;

            const change: RealtimeCommitmentChange = {
                eventType,
                newRow: toRealtimeCommitmentRow(payload.new),
                oldRow: toRealtimeCommitmentRow(payload.old),
                receivedAt: Date.now(),
            };
            emitRealtimeCommitmentChange(change);
            return eventType;
        };

        const handleGoogleOutboxToast = (payload: { new?: unknown; old?: unknown }) => {
            const outboxRow = toGoogleCalendarOutboxRow(payload.new);
            if (!outboxRow) return;
            if (outboxRow.user_id !== userId) return;
            if (outboxRow.status !== "DONE" && outboxRow.status !== "FAILED") return;

            const dedupeKey = `${outboxRow.id}:${outboxRow.status}`;
            if (seenGoogleOutboxStateRef.current.has(dedupeKey)) {
                return;
            }
            seenGoogleOutboxStateRef.current.add(dedupeKey);
            if (seenGoogleOutboxStateRef.current.size > 500) {
                // Keep memory bounded for long-lived dashboard sessions.
                const [first] = seenGoogleOutboxStateRef.current;
                if (first) {
                    seenGoogleOutboxStateRef.current.delete(first);
                }
            }

            if (outboxRow.status === "DONE") {
                if (outboxRow.intent === "DELETE") {
                    toast.success("Task removed from Google Calendar.");
                } else {
                    toast.success("Task synced to Google Calendar.");
                }
                return;
            }

            const detail = outboxRow.last_error?.trim();
            if (outboxRow.intent === "DELETE") {
                toast.error(detail ? `Google delete failed: ${detail}` : "Google delete failed.");
            } else {
                toast.error(detail ? `Google sync failed: ${detail}` : "Google sync failed.");
            }
        };

        // Subscribe to tasks relevant to the current user as owner or voucher.
        const tasksChannel = supabase
            .channel('realtime:tasks')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'tasks',
                    filter: `voucher_id=eq.${userId}`,
                },
                (payload) => {
                    if (ENABLE_REALTIME_DEBUG_LOGS) {
                        console.log("[Realtime][tasks][voucher]", payload.eventType, payload.new, payload.old);
                    }
                    const eventType = emitTaskChange(payload);
                    const refreshMode =
                        eventType === "UPDATE" && patchEnabledForPath ? "reconcile" : "fast";
                    scheduleRefresh(refreshMode);
                }
            )
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'tasks',
                    filter: `user_id=eq.${userId}`,
                },
                (payload) => {
                    if (ENABLE_REALTIME_DEBUG_LOGS) {
                        console.log("[Realtime][tasks][owner]", payload.eventType, payload.new, payload.old);
                    }
                    const eventType = emitTaskChange(payload);
                    const refreshMode =
                        eventType === "UPDATE" && patchEnabledForPath ? "reconcile" : "fast";
                    scheduleRefresh(refreshMode);
                }
            )
            .subscribe((status) => {
                if (ENABLE_REALTIME_DEBUG_LOGS) {
                    console.log("[Realtime][tasks] subscription:", status);
                }
            });

        // Keep local friend IDs in sync so we only refresh for relevant friend pomo updates.
        void syncFriendIds();

        // Subscribe to friendships
        const friendsChannel = supabase
            .channel('realtime:friendships')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'friendships',
                },
                (payload) => {
                    const newFriendship = payload.new as { user_id?: string; friend_id?: string } | null;
                    const oldFriendship = payload.old as { user_id?: string; friend_id?: string } | null;

                    const isRelevant =
                        (newFriendship && (newFriendship.user_id === userId || newFriendship.friend_id === userId)) ||
                        (oldFriendship && (oldFriendship.user_id === userId || oldFriendship.friend_id === userId));

                    if (isRelevant) {
                        if (ENABLE_REALTIME_DEBUG_LOGS) {
                            console.log("[Realtime][friendships] relevant update:", payload.eventType);
                        }
                        void syncFriendIds();
                        scheduleRefresh();
                    }
                }
            )
            .subscribe((status) => {
                if (ENABLE_REALTIME_DEBUG_LOGS) {
                    console.log("[Realtime][friendships] subscription:", status);
                }
            });

        // Subscribe to commitments for the current user.
        const commitmentsChannel = supabase
            .channel("realtime:commitments")
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "commitments",
                    filter: `user_id=eq.${userId}`,
                },
                (payload) => {
                    if (ENABLE_REALTIME_DEBUG_LOGS) {
                        console.log("[Realtime][commitments]", payload.eventType, payload.new, payload.old);
                    }
                    const eventType = emitCommitmentChange(payload);
                    const refreshMode =
                        eventType === "UPDATE" && patchEnabledForPath ? "reconcile" : "fast";
                    scheduleRefresh(refreshMode);
                }
            )
            .subscribe((status) => {
                if (ENABLE_REALTIME_DEBUG_LOGS) {
                    console.log("[Realtime][commitments] subscription:", status);
                }
            });

        // Subscribe to friend pomodoro sessions; refresh only when impacted friend rows change.
        const pomoChannel = supabase
            .channel('realtime:pomo_sessions')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'pomo_sessions',
                },
                (payload) => {
                    const nextRow = payload.new as { user_id?: string } | null;
                    const prevRow = payload.old as { user_id?: string } | null;
                    const affectedUserIds = [nextRow?.user_id, prevRow?.user_id].filter(
                        (id): id is string => Boolean(id)
                    );

                    if (affectedUserIds.length === 0) return;
                    if (affectedUserIds.includes(userId)) return;

                    const isRelevant = affectedUserIds.some((id) => friendIdsRef.current.has(id));
                    if (!isRelevant) return;

                    if (ENABLE_REALTIME_DEBUG_LOGS) {
                        console.log("[Realtime][pomo_sessions] relevant update:", payload.eventType, payload.new, payload.old);
                    }

                    scheduleRefresh();
                }
            )
            .subscribe((status) => {
                if (ENABLE_REALTIME_DEBUG_LOGS) {
                    console.log("[Realtime][pomo_sessions] subscription:", status);
                }
            });

        // Subscribe to Google Calendar outbox updates and emit sync toasts.
        const googleCalendarOutboxChannel = supabase
            .channel("realtime:google_calendar_sync_outbox")
            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "public",
                    table: "google_calendar_sync_outbox",
                    filter: `user_id=eq.${userId}`,
                },
                (payload) => {
                    if (ENABLE_REALTIME_DEBUG_LOGS) {
                        console.log("[Realtime][google_calendar_sync_outbox]", payload.eventType, payload.new, payload.old);
                    }
                    handleGoogleOutboxToast(payload);
                }
            )
            .subscribe((status) => {
                if (ENABLE_REALTIME_DEBUG_LOGS) {
                    console.log("[Realtime][google_calendar_sync_outbox] subscription:", status);
                }
            });

        return () => {
            isActive = false;
            if (refreshTimeoutRef.current) {
                window.clearTimeout(refreshTimeoutRef.current);
                refreshTimeoutRef.current = null;
            }
            supabase.removeChannel(tasksChannel);
            supabase.removeChannel(friendsChannel);
            supabase.removeChannel(commitmentsChannel);
            supabase.removeChannel(pomoChannel);
            supabase.removeChannel(googleCalendarOutboxChannel);
        };
    }, [userId, router, pathname]);

    return null;
}
