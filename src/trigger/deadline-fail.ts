/**
 * Trigger: deadline-fail
 * Runs: Every 5 minutes (configured with a 5-minute cron interval).
 * What it does when it runs:
 * 1) Finds tasks in ACTIVE or POSTPONED whose displayed deadline minute has ended.
 * 2) Marks each matched task as MISSED.
 * 3) Writes a positive failure ledger entry for the task owner.
 * 4) Logs a DEADLINE_MISSED system event in task_events.
 */
import { schedules } from "@trigger.dev/sdk/v3";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueGoogleCalendarOutbox } from "@/lib/google-calendar/sync";
import { notifyCommitmentFailureIfNeeded } from "@/actions/commitments";
import { SYSTEM_ACTOR_PROFILE_ID } from "@/lib/system-actor";
import { claimTasksByIdsAndStatus } from "@/trigger/claim-utils";
import { sendNotification } from "@/lib/notifications";
import { getDeadlineMissCutoffIso, isDeadlineMissEligible } from "@/lib/deadline-miss-window";

export const deadlineFail = schedules.task({
    id: "deadline-fail",
    cron: "*/5 * * * *", // Run every 5 minutes
    run: async (payload, { ctx }) => {
        const supabase = createAdminClient();
        const now = new Date();
        const nowIso = now.toISOString();
        const missCutoffIso = getDeadlineMissCutoffIso(now);
        const currentPeriod = nowIso.slice(0, 7);

        // Find candidates first, then claim by status group to avoid duplicate processing
        // across overlapping runs.
        const { data, error } = await supabase
            .from("tasks")
            .select("id, user_id, title, status, failure_cost_cents, deadline, recurrence_rule_id")
            .in("status", ["ACTIVE", "POSTPONED"])
            .lte("deadline", missCutoffIso as any) as any;

        const rawCandidates = (data || []) as Array<{
            id: string;
            user_id: string;
            title: string;
            status: "ACTIVE" | "POSTPONED";
            failure_cost_cents: number;
            deadline: string;
            recurrence_rule_id: string | null;
        }>;

        if (error) {
            console.error("Error fetching tasks:", error);
            return;
        }

        const candidates = rawCandidates.filter((task) => isDeadlineMissEligible(task.deadline, now));

        if (candidates.length === 0) {
            return;
        }

        const byId = new Map(candidates.map((task) => [task.id, task]));
        const activeIds = candidates.filter((task) => task.status === "ACTIVE").map((task) => task.id);
        const postponedIds = candidates.filter((task) => task.status === "POSTPONED").map((task) => task.id);

        const claimedIds: string[] = [];
        if (activeIds.length > 0) {
            try {
                const activeClaimed = await claimTasksByIdsAndStatus(
                    supabase,
                    activeIds,
                    "ACTIVE",
                    { status: "MISSED", updated_at: nowIso }
                );
                claimedIds.push(...activeClaimed);
            } catch (claimError) {
                console.error("Failed claiming ACTIVE overdue tasks:", claimError);
            }
        }
        if (postponedIds.length > 0) {
            try {
                const postponedClaimed = await claimTasksByIdsAndStatus(
                    supabase,
                    postponedIds,
                    "POSTPONED",
                    { status: "MISSED", updated_at: nowIso }
                );
                claimedIds.push(...postponedClaimed);
            } catch (claimError) {
                console.error("Failed claiming POSTPONED overdue tasks:", claimError);
            }
        }

        if (claimedIds.length === 0) {
            return;
        }

        const claimedTasks = claimedIds
            .map((taskId) => byId.get(taskId))
            .filter((task): task is NonNullable<typeof task> => Boolean(task));

        const ledgerRows = claimedTasks.map((task) => ({
            user_id: task.user_id,
            task_id: task.id,
            period: currentPeriod,
            amount_cents: task.failure_cost_cents,
            entry_type: "failure",
        }));
        const eventRows = claimedTasks.map((task) => ({
            task_id: task.id,
            event_type: "DEADLINE_MISSED",
            actor_id: SYSTEM_ACTOR_PROFILE_ID,
            from_status: task.status,
            to_status: "MISSED",
            metadata: { reason: "Deadline passed without completion" },
        }));

        const [{ error: ledgerError }, { error: eventError }] = await Promise.all([
            (supabase.from("ledger_entries") as any).insert(ledgerRows as any),
            (supabase.from("task_events") as any).insert(eventRows as any),
        ]);
        if (ledgerError) {
            console.error("Failed inserting deadline-fail ledger entries:", ledgerError);
        }
        if (eventError) {
            console.error("Failed inserting deadline-fail events:", eventError);
        }

        // Group missed tasks by user for batched notifications
        const tasksByUser = new Map<string, typeof claimedTasks>();
        for (const task of claimedTasks) {
            const existing = tasksByUser.get(task.user_id) || [];
            existing.push(task);
            tasksByUser.set(task.user_id, existing);
        }

        await Promise.all([
            ...claimedTasks.map(async (task) => {
                try {
                    await enqueueGoogleCalendarOutbox(task.user_id, task.id, "UPSERT");
                } catch (error) {
                    console.error(`Failed to enqueue Google finalize for task ${task.id}:`, error);
                }
                try {
                    await notifyCommitmentFailureIfNeeded(task.id, task.recurrence_rule_id ?? null);
                } catch (error) {
                    console.error(`Failed to notify commitment failure for task ${task.id}:`, error);
                }
            }),
            ...Array.from(tasksByUser.entries()).map(async ([userId, tasks]) => {
                try {
                    const title = tasks.length === 1
                        ? "Task missed"
                        : `${tasks.length} tasks missed`;
                    const text = tasks.length === 1
                        ? `"${tasks[0].title}" deadline has passed.`
                        : `${tasks.length} task deadlines have passed.`;
                    await sendNotification({
                        userId,
                        title,
                        text,
                        email: false,
                        push: true,
                        url: tasks.length === 1 ? `/tasks/${tasks[0].id}` : "/tasks",
                        tag: `deadline-missed-${nowIso.slice(0, 16)}`,
                        data: {
                            kind: "DEADLINE_MISSED",
                            taskIds: tasks.map((t) => t.id),
                        },
                    });
                } catch (error) {
                    console.error(`Failed to send deadline-missed notification for user ${userId}:`, error);
                }
            }),
        ]);

        console.log(`Failed ${claimedTasks.length} tasks due to passed deadline`);
    },
});
