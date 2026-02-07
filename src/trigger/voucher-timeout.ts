import { schedules } from "@trigger.dev/sdk/v3";
import { createAdminClient } from "@/lib/supabase/admin";

const VOUCHER_TIMEOUT_PENALTY_CENTS = 30;

interface TimeoutTask {
    id: string;
    user_id: string;
    voucher_id: string;
    failure_cost_cents: number;
}

export const voucherTimeout = schedules.task({
    id: "voucher-timeout",
    cron: "0 * * * *", // Run every hour
    run: async () => {
        const supabase = createAdminClient();
        const now = new Date().toISOString();

        const { data, error } = await (supabase
            .from("tasks")
            .select("id, user_id, voucher_id, failure_cost_cents")
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
                    .update({ status: "FAILED" })
                    .eq("id", task.id)
                    .eq("status", "AWAITING_VOUCHER")
                    .select("id")
                    .maybeSingle();

                if (updateError) {
                    console.error(`Failed to mark task ${task.id} as FAILED:`, updateError);
                    continue;
                }
                if (!updatedTask) {
                    continue;
                }

                const currentPeriod = new Date().toISOString().slice(0, 7);

                const { error: ownerLedgerError } = await (supabase.from("ledger_entries") as any).insert({
                    user_id: task.user_id,
                    task_id: task.id,
                    period: currentPeriod,
                    amount_cents: task.failure_cost_cents,
                    entry_type: "failure",
                });

                if (ownerLedgerError) {
                    console.error(`Failed to add owner failure ledger entry for task ${task.id}:`, ownerLedgerError);
                }

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
                    to_status: "FAILED",
                    metadata: {
                        reason: "Voucher did not respond in time",
                        voucher_penalty_cents: VOUCHER_TIMEOUT_PENALTY_CENTS,
                    },
                });

                if (eventError) {
                    console.error(`Failed to insert VOUCHER_TIMEOUT event for task ${task.id}:`, eventError);
                }

                console.log(`Failed task ${task.id} due to voucher timeout`);
            } catch (taskError) {
                console.error(`Unexpected error while processing task ${task.id}:`, taskError);
            }
        }
    },
});

