/**
 * Trigger: voucher-timeout
 * Runs: Every hour at minute 0 (`0 * * * *`).
 * What it does when it runs:
 * 1) Finds tasks still in AWAITING_VOUCHER where voucher_response_deadline has passed.
 * 2) Atomically flips each matched task to AUTO_ACCEPTED.
 * 3) Adds only a voucher timeout penalty ledger entry for the voucher.
 * 4) Deletes volatile proof media and logs a VOUCHER_TIMEOUT system event.
 * 5) Skips AI-vouched tasks (AI processes deterministically, no timeout).
 */
import { schedules } from "@trigger.dev/sdk/v3";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteTaskProof } from "@/lib/task-proof";
import { enqueueGoogleCalendarOutbox } from "@/lib/google-calendar/sync";
import { AI_PROFILE_ID } from "@/lib/ai-voucher/constants";
import { SYSTEM_ACTOR_PROFILE_ID } from "@/lib/system-actor";
import { claimTasksByIdsAndStatus } from "@/trigger/claim-utils";

const VOUCHER_TIMEOUT_PENALTY_CENTS = 30;

interface TimeoutTask {
    id: string;
    voucher_id: string;
    user_id: string;
}

export const voucherTimeout = schedules.task({
    id: "voucher-timeout",
    cron: "0 * * * *", // Run every hour
    run: async () => {
        const supabase = createAdminClient();
        const now = new Date().toISOString();
        const currentPeriod = new Date().toISOString().slice(0, 7);

        const { data, error } = await (supabase
            .from("tasks")
            .select("id, voucher_id, user_id")
            .eq("status", "AWAITING_VOUCHER")
            .neq("voucher_id", AI_PROFILE_ID)
            .lt("voucher_response_deadline", now) as any);

        if (error) {
            console.error("Error fetching tasks:", error);
            return;
        }

        const candidates = (data || []) as TimeoutTask[];
        if (candidates.length === 0) {
            return;
        }

        const byId = new Map(candidates.map((task) => [task.id, task]));
        const candidateIds = candidates.map((task) => task.id);
        let claimedIds: string[] = [];
        try {
            claimedIds = await claimTasksByIdsAndStatus(
                supabase,
                candidateIds,
                "AWAITING_VOUCHER",
                { status: "AUTO_ACCEPTED", voucher_timeout_auto_accepted: true, updated_at: now }
            );
        } catch (claimError) {
            console.error("Failed bulk update for voucher-timeout:", claimError);
            return;
        }
        const claimedTasks = claimedIds
            .map((taskId) => byId.get(taskId))
            .filter((task): task is TimeoutTask => Boolean(task));

        if (claimedTasks.length === 0) {
            return;
        }

        const ledgerRows = claimedTasks.map((task) => ({
            user_id: task.voucher_id,
            task_id: task.id,
            period: currentPeriod,
            amount_cents: VOUCHER_TIMEOUT_PENALTY_CENTS,
            entry_type: "voucher_timeout_penalty",
        }));
        const eventRows = claimedTasks.map((task) => ({
            task_id: task.id,
            event_type: "VOUCHER_TIMEOUT",
            actor_id: SYSTEM_ACTOR_PROFILE_ID,
            from_status: "AWAITING_VOUCHER",
            to_status: "AUTO_ACCEPTED",
            metadata: {
                reason: "Voucher did not respond in time; task auto-accepted",
                voucher_penalty_cents: VOUCHER_TIMEOUT_PENALTY_CENTS,
                auto_accepted: true,
            },
        }));

        const [{ error: ledgerError }, { error: eventError }] = await Promise.all([
            (supabase.from("ledger_entries") as any).insert(ledgerRows as any),
            (supabase.from("task_events") as any).insert(eventRows as any),
        ]);
        if (ledgerError) {
            console.error("Failed bulk voucher-timeout ledger insert:", ledgerError);
        }
        if (eventError) {
            console.error("Failed bulk voucher-timeout event insert:", eventError);
        }

        await Promise.all(claimedTasks.map(async (task) => {
            try {
                const cleanup = await deleteTaskProof(task.id, "voucher_timeout_auto_accept");
                if (!cleanup.success) {
                    console.error(`Failed to cleanup proof for timed-out task ${task.id}:`, cleanup.error);
                }

                await enqueueGoogleCalendarOutbox(task.user_id, task.id, "UPSERT");
            } catch (taskError) {
                console.error(`Unexpected error while processing task ${task.id}:`, taskError);
            }
        }));

        console.log(`Auto-accepted ${claimedTasks.length} tasks due to voucher timeout`);
    },
});
