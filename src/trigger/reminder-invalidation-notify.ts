/**
 * Trigger: reminder-invalidation-notify
 * Runs: Every minute (`* * * * *`), and directly after reminder mutations.
 * What it does when it runs:
 * 1) Drains pending rows from `reminder_invalidations`.
 * 2) Sends a silent data push waking each affected device.
 * 3) Marks the rows dispatched.
 *
 * Why this exists: reminders are armed ahead of time on each device's own OS
 * scheduler so they fire punctually. iOS will not run app code before showing a
 * scheduled local notification, so a device that was offline when the user
 * postponed a task from another client would otherwise fire the old alarm. A
 * content-available push wakes the app in the background just long enough to
 * cancel the stale schedule and arm the current one.
 *
 * Best-effort by design: iOS throttles background pushes and a powered-off
 * device receives nothing. The app also re-syncs on realtime reminder changes
 * and on foreground, so a missed wake-up self-corrects on next open.
 */
import { schedules, task } from "@trigger.dev/sdk/v3";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendExpoDataPushToUser } from "@/lib/expo-push";

const INVALIDATION_BATCH_LIMIT = 500;

export interface PendingReminderInvalidation {
    id: number;
    user_id: string;
    user_client_instance_id: string;
}

export function groupInvalidationsByUser(
    rows: PendingReminderInvalidation[]
): Map<string, string[]> {
    const instancesByUser = new Map<string, string[]>();

    for (const row of rows) {
        const existing = instancesByUser.get(row.user_id);
        if (existing) {
            existing.push(row.user_client_instance_id);
            continue;
        }
        instancesByUser.set(row.user_id, [row.user_client_instance_id]);
    }

    return instancesByUser;
}

export function buildReminderInvalidationData() {
    return {
        kind: "REMINDER_INVALIDATED",
        category: "REMINDER_SYNC",
    };
}

export async function dispatchPendingReminderInvalidations(
    supabase: ReturnType<typeof createAdminClient>
): Promise<{ dispatched: number; failed: number }> {
    const { data, error } = await supabase
        .from("reminder_invalidations")
        .select("id, user_id, user_client_instance_id")
        .is("dispatched_at", null)
        .order("created_at", { ascending: true })
        .limit(INVALIDATION_BATCH_LIMIT);

    if (error) {
        console.error("Failed to load pending reminder invalidations:", error);
        return { dispatched: 0, failed: 0 };
    }

    const pending = ((data as PendingReminderInvalidation[] | null) || []);
    if (pending.length === 0) return { dispatched: 0, failed: 0 };

    const dispatchedIds: number[] = [];
    let failed = 0;

    for (const [userId, instanceIds] of groupInvalidationsByUser(pending)) {
        const rowIds = pending
            .filter((row) => row.user_id === userId)
            .map((row) => row.id);

        try {
            await sendExpoDataPushToUser(userId, {
                data: buildReminderInvalidationData(),
                ttlSeconds: 60,
                onlyClientInstanceIds: instanceIds,
            });
            dispatchedIds.push(...rowIds);
        } catch (sendError) {
            // Leave the rows pending so the next run retries them.
            failed += rowIds.length;
            console.warn("[reminder-invalidation-notify] wake-up push failed:", {
                userId,
                error: sendError,
            });
        }
    }

    if (dispatchedIds.length > 0) {
        // Same cast the other trigger jobs use (see claim-utils): this
        // Database type is hand-maintained and update() inference does not
        // resolve through it.
        const { error: stampError } = await (supabase.from("reminder_invalidations") as any)
            .update({ dispatched_at: new Date().toISOString() } as any)
            .in("id", dispatchedIds as any);

        if (stampError) {
            console.error("Failed to mark reminder invalidations dispatched:", stampError);
        }
    }

    return { dispatched: dispatchedIds.length, failed };
}

/**
 * Callable directly from mutation paths (postpone, deadline edit) so the common
 * case corrects within seconds instead of waiting for the next scheduled drain.
 */
export const reminderInvalidationFlush = task({
    id: "reminder-invalidation-flush",
    run: async () => dispatchPendingReminderInvalidations(createAdminClient()),
});

export const reminderInvalidationNotify = schedules.task({
    id: "reminder-invalidation-notify",
    cron: "* * * * *",
    run: async () => dispatchPendingReminderInvalidations(createAdminClient()),
});
