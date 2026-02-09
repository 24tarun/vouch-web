/**
 * Trigger: voucher-timeout
 * Runs: Every hour at minute 0 (`0 * * * *`).
 * What it does when it runs:
 * 1) Finds tasks still in AWAITING_VOUCHER where voucher_response_deadline has passed.
 * 2) Atomically flips each matched task to COMPLETED (auto-accept).
 * 3) Adds only a voucher timeout penalty ledger entry for the voucher.
 * 4) Deletes volatile proof media and logs a VOUCHER_TIMEOUT system event.
 */
import { schedules } from "@trigger.dev/sdk/v3";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteTaskProof } from "@/lib/task-proof";

const VOUCHER_TIMEOUT_PENALTY_CENTS = 30;

interface TimeoutTask {
    id: string;
    voucher_id: string;
}

export const voucherTimeout = schedules.task({
    id: "voucher-timeout",
    cron: "0 * * * *", // Run every hour
    run: async () => {
        const supabase = createAdminClient();
        const now = new Date().toISOString();

        const { data, error } = await (supabase
            .from("tasks")
            .select("id, voucher_id")
            .eq("status", "AWAITING_VOUCHER")
            .lt("voucher_response_deadline", now) as any);

        if (error) {
            console.error("Error fetching tasks:", error);
            return;
        }

        const tasks = (data || []) as TimeoutTask[];
        console.log(`Found ${tasks.length} tasks to timeout`);

        for (const task of tasks) {
            try {
                const { data: updatedTask, error: updateError } = await (supabase
                    .from("tasks") as any)
                    .update({ status: "COMPLETED", updated_at: now })
                    .eq("id", task.id)
                    .eq("status", "AWAITING_VOUCHER")
                    .select("id")
                    .maybeSingle();

                if (updateError) {
                    console.error(`Failed to auto-accept task ${task.id}:`, updateError);
                    continue;
                }
                if (!updatedTask) {
                    continue;
                }

                const cleanup = await deleteTaskProof(task.id, "voucher_timeout_auto_accept");
                if (!cleanup.success) {
                    console.error(`Failed to cleanup proof for timed-out task ${task.id}:`, cleanup.error);
                }

                const currentPeriod = new Date().toISOString().slice(0, 7);

                const { error: voucherPenaltyError } = await (supabase.from("ledger_entries") as any).insert({
                    user_id: task.voucher_id,
                    task_id: task.id,
                    period: currentPeriod,
                    amount_cents: VOUCHER_TIMEOUT_PENALTY_CENTS,
                    entry_type: "voucher_timeout_penalty",
                });

                if (voucherPenaltyError) {
                    console.error(`Failed to add voucher timeout penalty for task ${task.id}:`, voucherPenaltyError);
                }

                const { error: eventError } = await (supabase.from("task_events") as any).insert({
                    task_id: task.id,
                    event_type: "VOUCHER_TIMEOUT",
                    actor_id: null,
                    from_status: "AWAITING_VOUCHER",
                    to_status: "COMPLETED",
                    metadata: {
                        reason: "Voucher did not respond in time; task auto-accepted",
                        voucher_penalty_cents: VOUCHER_TIMEOUT_PENALTY_CENTS,
                        auto_accepted: true,
                    },
                });

                if (eventError) {
                    console.error(`Failed to insert VOUCHER_TIMEOUT event for task ${task.id}:`, eventError);
                }

                console.log(`Auto-accepted task ${task.id} due to voucher timeout`);
            } catch (taskError) {
                console.error(`Unexpected error while processing task ${task.id}:`, taskError);
            }
        }
    },
});

