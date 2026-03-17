import { computeFullReputationScore } from "./algorithm";
import type { ReputationTaskInput } from "./types";

/**
 * Simulates completing a task and returns how many RP the user would gain.
 * Returns 0 if the delta is negative or the task is not found.
 */
export function computePotentialRpGain(
    tasks: ReputationTaskInput[],
    taskId: string,
    userId: string
): number {
    const current = computeFullReputationScore(tasks, userId);

    const simulatedNow = new Date().toISOString();
    const simulatedTasks = tasks.map((t) =>
        t.id === taskId
            ? { ...t, status: "COMPLETED", marked_completed_at: simulatedNow }
            : t
    );

    const future = computeFullReputationScore(simulatedTasks, userId);
    return Math.max(0, future.score - current.score);
}
