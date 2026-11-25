import { schedules, task } from "@trigger.dev/sdk/v3";
import {
    processGoogleCalendarOutboxItem,
    retryPendingGoogleCalendarOutbox,
} from "@/lib/google-calendar/sync";

export const googleCalendarDispatch = task({
    id: "google-calendar-dispatch",
    run: async (payload: { outboxId: number }) => {
        if (!payload?.outboxId) return;
        await processGoogleCalendarOutboxItem(payload.outboxId);
    },
});

export const googleCalendarOutboxSweeper = schedules.task({
    id: "google-calendar-outbox-sweeper",
    cron: "0 * * * *",
    run: async () => {
        await retryPendingGoogleCalendarOutbox(200);
    },
});
