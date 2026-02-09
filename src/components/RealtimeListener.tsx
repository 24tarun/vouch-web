"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const ENABLE_REALTIME_DEBUG_LOGS = process.env.NODE_ENV !== "production";

export function RealtimeListener({ userId }: { userId: string }) {
    const router = useRouter();
    const supabaseRef = useRef(createClient());
    const refreshTimeoutRef = useRef<number | null>(null);
    const lastRefreshAtRef = useRef(0);
    const REFRESH_THROTTLE_MS = 300;

    useEffect(() => {
        if (!userId) return;
        const supabase = supabaseRef.current;
        const scheduleRefresh = () => {
            const now = Date.now();
            const elapsed = now - lastRefreshAtRef.current;
            const remaining = Math.max(0, REFRESH_THROTTLE_MS - elapsed);
            if (refreshTimeoutRef.current) return;

            refreshTimeoutRef.current = window.setTimeout(() => {
                lastRefreshAtRef.current = Date.now();
                refreshTimeoutRef.current = null;
                router.refresh();
            }, remaining);
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
                    scheduleRefresh();
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
                    scheduleRefresh();
                }
            )
            .subscribe((status) => {
                if (ENABLE_REALTIME_DEBUG_LOGS) {
                    console.log("[Realtime][tasks] subscription:", status);
                }
            });

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
                        scheduleRefresh();
                    }
                }
            )
            .subscribe((status) => {
                if (ENABLE_REALTIME_DEBUG_LOGS) {
                    console.log("[Realtime][friendships] subscription:", status);
                }
            });

        return () => {
            if (refreshTimeoutRef.current) {
                window.clearTimeout(refreshTimeoutRef.current);
                refreshTimeoutRef.current = null;
            }
            supabase.removeChannel(tasksChannel);
            supabase.removeChannel(friendsChannel);
        };
    }, [userId, router]);

    return null;
}
