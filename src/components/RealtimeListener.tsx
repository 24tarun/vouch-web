"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function RealtimeListener({ userId }: { userId: string }) {
    const router = useRouter();
    const supabaseRef = useRef(createClient());

    useEffect(() => {
        if (!userId) return;
        const supabase = supabaseRef.current;

        // Subscribe to tasks
        const tasksChannel = supabase
            .channel('realtime:tasks')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'tasks',
                },
                (payload) => {
                    console.log("Realtime task event:", payload.eventType, payload.new, payload.old);
                    const newTask = payload.new as any;
                    const oldTask = payload.old as any;

                    // Check if user is owner or voucher of the task (new or old)
                    const isRelevant =
                        (newTask && (newTask.user_id === userId || newTask.voucher_id === userId)) ||
                        (oldTask && (oldTask.user_id === userId || oldTask.voucher_id === userId));

                    if (isRelevant) {
                        console.log("Relevant change! Refreshing dashboard...");
                        router.refresh();
                    } else {
                        console.log("Irrelevant change for user:", userId);
                    }
                }
            )
            .subscribe((status) => {
                console.log("Tasks subscription status:", status);
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
                    const newFriendship = payload.new as any;
                    const oldFriendship = payload.old as any;

                    const isRelevant =
                        (newFriendship && (newFriendship.user_id === userId || newFriendship.friend_id === userId)) ||
                        (oldFriendship && (oldFriendship.user_id === userId || oldFriendship.friend_id === userId));

                    if (isRelevant) {
                        console.log("Realtime friendship update detected, refreshing...");
                        router.refresh();
                    }
                }
            )
            .subscribe((status) => {
                console.log("Friendships subscription status:", status);
            });

        return () => {
            supabase.removeChannel(tasksChannel);
            supabase.removeChannel(friendsChannel);
        };
    }, [userId, router]);

    return null;
}
