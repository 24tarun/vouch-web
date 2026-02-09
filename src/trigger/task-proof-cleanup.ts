/**
 * Trigger: task-proof-cleanup
 * Runs: Every 5 minutes (cron expression every 5 min).
 * What it does when it runs:
 * 1) Scans completion proof rows.
 * 2) Deletes proofs for tasks that are no longer awaiting voucher.
 * 3) Deletes proofs after voucher response deadline expiry.
 * 4) Deletes stale pending uploads that never finalized.
 */
import { schedules } from "@trigger.dev/sdk/v3";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteTaskProof } from "@/lib/task-proof";

const STALE_PENDING_UPLOAD_MS = 20 * 60 * 1000;

interface ProofCandidate {
    task_id: string;
    upload_state: "PENDING" | "UPLOADED" | "FAILED";
    created_at: string;
    task: {
        status: string;
        voucher_response_deadline: string | null;
    } | null;
}

export const taskProofCleanup = schedules.task({
    id: "task-proof-cleanup",
    cron: "*/5 * * * *",
    run: async () => {
        const supabase = createAdminClient();
        const nowMs = Date.now();

        const { data, error } = await (supabase.from("task_completion_proofs") as any)
            .select(`
                task_id,
                upload_state,
                created_at,
                task:tasks!task_completion_proofs_task_id_fkey(status, voucher_response_deadline)
            `)
            .limit(1000);

        if (error) {
            console.error("Failed to load proof candidates for cleanup:", error);
            return;
        }

        const candidates = ((data as ProofCandidate[] | null) || []);
        if (candidates.length === 0) return;

        for (const candidate of candidates) {
            const task = candidate.task;
            const stalePending =
                candidate.upload_state === "PENDING" &&
                nowMs - new Date(candidate.created_at).getTime() > STALE_PENDING_UPLOAD_MS;
            const responseExpired =
                Boolean(task?.voucher_response_deadline) &&
                nowMs > new Date(task!.voucher_response_deadline as string).getTime();
            const noLongerAwaiting = Boolean(task) && task!.status !== "AWAITING_VOUCHER";
            const missingTask = !task;

            if (!stalePending && !responseExpired && !noLongerAwaiting && !missingTask) {
                continue;
            }

            const cleanup = await deleteTaskProof(candidate.task_id, "scheduled_cleanup");
            if (!cleanup.success) {
                console.error(`Failed to cleanup proof for task ${candidate.task_id}:`, cleanup.error);
            }
        }
    },
});
