import { schedules } from "@trigger.dev/sdk/v3";
import { createAdminClient } from "@/lib/supabase/admin";

export const voucherTimeout = schedules.task({
    id: "voucher-timeout",
    cron: "0 * * * *", // Run every hour
    run: async (payload, { ctx }) => {
        const supabase = createAdminClient();
        const now = new Date().toISOString();

        // Find tasks that are awaiting voucher and have passed the deadline
        const { data, error } = await supabase
            .from("tasks")
            .select("*")
            .eq("status", "AWAITING_VOUCHER")
            .lt("voucher_response_deadline", now) as any;

        const tasks = data || [];

        if (error) {
            console.error("Error fetching tasks:", error);
            return;
        }

        console.log(`Found ${tasks.length} tasks to timeout`);

        for (const task of tasks) {
            // Fail the task
            await (supabase.from("tasks") as any)
                .update({ status: "FAILED" })
                .eq("id", task.id);

            // Add failure cost to ledger
            const currentPeriod = new Date().toISOString().slice(0, 7);
            await (supabase.from("ledger_entries") as any).insert({
                user_id: task.user_id,
                task_id: task.id,
                period: currentPeriod,
                amount_cents: task.failure_cost_cents,
                entry_type: "failure",
            });

            // Log event
            await (supabase.from("task_events") as any).insert({
                task_id: task.id,
                event_type: "VOUCHER_TIMEOUT",
                actor_id: null, // System event
                from_status: "AWAITING_VOUCHER",
                to_status: "FAILED",
                metadata: { reason: "Voucher did not respond in time" },
            });

            console.log(`Failed task ${task.id} due to voucher timeout`);
        }
    },
});
