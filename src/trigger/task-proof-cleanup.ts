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
const CLEANUP_BATCH_SIZE = 20;

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

        const staleUploadCutoff = new Date(nowMs - STALE_PENDING_UPLOAD_MS).toISOString();
        // Two targeted queries instead of a full table scan:
        // 1. PENDING/FAILED proofs — always cleanup candidates
        // 2. UPLOADED proofs older than 10 minutes — task may have moved out of AWAITING_VOUCHER
        const uploadedCheckCutoff = new Date(nowMs - 10 * 60 * 1000).toISOString();
        const selectFields = `
            task_id,
            upload_state,
            created_at,
            task:tasks!task_completion_proofs_task_id_fkey(status, voucher_response_deadline)
        `;
        const [{ data: pendingData, error: pendingError }, { data: uploadedData, error: uploadedError }] = await Promise.all([
            (supabase.from("task_completion_proofs") as any)
                .select(selectFields)
                .in("upload_state", ["PENDING", "FAILED"])
                .limit(500),
            (supabase.from("task_completion_proofs") as any)
                .select(selectFields)
                .eq("upload_state", "UPLOADED")
                .lt("created_at", uploadedCheckCutoff)
                .limit(500),
        ]);

        const error = pendingError || uploadedError;
        const data = [...(pendingData || []), ...(uploadedData || [])];

        if (error) {
            console.error("Failed to load proof candidates for cleanup:", error);
            return;
        }

        const candidates = ((data as ProofCandidate[] | null) || []);
        if (candidates.length === 0) return;

        const cleanupTaskIds = new Set<string>();
        for (const candidate of candidates) {
            const task = candidate.task;
            const stalePending =
                candidate.upload_state === "PENDING" &&
                nowMs - new Date(candidate.created_at).getTime() > STALE_PENDING_UPLOAD_MS;
            const responseExpired =
                task?.status === "AWAITING_VOUCHER" &&
                Boolean(task.voucher_response_deadline) &&
                nowMs > new Date(task!.voucher_response_deadline as string).getTime();
            const noLongerAwaiting = Boolean(task) &&
                !["AWAITING_VOUCHER", "AWAITING_RECTIFICATION"].includes(task!.status);
            const missingTask = !task;

            if (!stalePending && !responseExpired && !noLongerAwaiting && !missingTask) {
                continue;
            }

            cleanupTaskIds.add(candidate.task_id);
        }

        const taskIds = Array.from(cleanupTaskIds.values());
        for (let index = 0; index < taskIds.length; index += CLEANUP_BATCH_SIZE) {
            const batch = taskIds.slice(index, index + CLEANUP_BATCH_SIZE);
            await Promise.all(batch.map(async (taskId) => {
                try {
                    const cleanup = await deleteTaskProof(taskId, "scheduled_cleanup");
                    if (!cleanup.success) {
                        console.error(`Failed to cleanup proof for task ${taskId}:`, cleanup.error);
                    }
                } catch (error) {
                    console.error(`Unexpected proof cleanup failure for task ${taskId}:`, error);
                }
            }));
        }
    },
});
