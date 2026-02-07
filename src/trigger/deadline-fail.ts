/**
 * Trigger: deadline-fail
 * Runs: Every 5 minutes (configured with a 5-minute cron interval).
 * What it does when it runs:
 * 1) Finds tasks in CREATED or POSTPONED whose deadline has already passed.
 * 2) Marks each matched task as FAILED.
 * 3) Writes a positive failure ledger entry for the task owner.
 * 4) Logs a DEADLINE_MISSED system event in task_events.
 */
import { schedules } from "@trigger.dev/sdk/v3";
import { createAdminClient } from "@/lib/supabase/admin";

export const deadlineFail = schedules.task({
    id: "deadline-fail",
    cron: "*/5 * * * *", // Run every 5 minutes
    run: async (payload, { ctx }) => {
        const supabase = createAdminClient();
        const now = new Date();
        const nowIso = now.toISOString();

        // Find tasks that are in CREATED or POSTPONED and have passed the deadline
        const { data, error } = await supabase
            .from("tasks")
            .select("*")
            .in("status", ["CREATED", "POSTPONED"])
            .lt("deadline", nowIso) as any;

        const tasks = data || [];

        if (error) {
            console.error("Error fetching tasks:", error);
            return;
        }

        console.log(`Found ${tasks.length} tasks to fail due to passed deadline`);

        for (const task of tasks) {
            // Fail the task
            await (supabase.from("tasks") as any)
                .update({ status: "FAILED", updated_at: nowIso })
                .eq("id", task.id);

            // Add failure cost to ledger
            const currentPeriod = nowIso.slice(0, 7);
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
                event_type: "DEADLINE_MISSED",
                actor_id: null, // System event
                from_status: task.status,
                to_status: "FAILED",
                metadata: { reason: "Deadline passed without completion" },
            });

            console.log(`Failed task ${task.id} due to passed deadline`);
        }
    },
});
