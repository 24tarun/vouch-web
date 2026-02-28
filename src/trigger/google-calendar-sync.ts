import { schedules, task } from "@trigger.dev/sdk/v3";
import {
    processGoogleCalendarDeltaForUser,
    processGoogleCalendarOutboxItem,
    reconcileStaleGoogleCalendarConnections,
    renewExpiringGoogleCalendarWatches,
    retryPendingGoogleCalendarOutbox,
    syncGoogleCalendarForEnabledConnections,
} from "@/lib/google-calendar/sync";

export const googleCalendarDispatch = task({
    id: "google-calendar-dispatch",
    run: async (payload: { outboxId: number }) => {
        if (!payload?.outboxId) return;
        await processGoogleCalendarOutboxItem(payload.outboxId);
    },
});

export const googleCalendarSyncConnection = task({
    id: "google-calendar-sync-connection",
    run: async (payload: { userId: string; reason?: string }) => {
        if (!payload?.userId) return;
        await processGoogleCalendarDeltaForUser(payload.userId);
    },
});

// Single per-minute maintenance sweep for Google integration.
export const googleCalendarSyncSweeper = schedules.task({
    id: "google-calendar-sync-sweeper",
    cron: "* * * * *",
    run: async () => {
        await syncGoogleCalendarForEnabledConnections(200);
        await retryPendingGoogleCalendarOutbox(200);
        await reconcileStaleGoogleCalendarConnections();
    },
});

export const googleCalendarWatchRenew = schedules.task({
    id: "google-calendar-watch-renew",
    cron: "0 * * * *",
    run: async () => {
        await renewExpiringGoogleCalendarWatches();
    },
});
