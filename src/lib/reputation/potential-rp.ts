import { computeFullReputationScore } from "./algorithm";
import type { ReputationTaskInput } from "./types";

export function computePotentialRpGain(
    tasks: ReputationTaskInput[],
    taskId: string,
    userId: string
): number {
    const current = computeFullReputationScore(tasks, userId);

    const simulatedNow = new Date().toISOString();
    const simulatedTasks = tasks.map((t) =>
        t.id === taskId
            ? { ...t, status: "ACCEPTED", marked_completed_at: simulatedNow }
            : t
    );

    const future = computeFullReputationScore(simulatedTasks, userId);
    return Math.max(0, future.score - current.score);
}
