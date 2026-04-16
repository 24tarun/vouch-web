import {
    SCORE_BASE,
    BAYESIAN_BASE_WEIGHT,
    BAYESIAN_TASK_THRESHOLD,
    WEIGHT_DELIVERY,
    WEIGHT_ACCOUNTABILITY,
    WEIGHT_DISCIPLINE,
    WEIGHT_PROOF_QUALITY,
    WEIGHT_COMMUNITY,
    ACCOUNTABILITY_RECENCY_HALF_LIFE_DAYS,
    VELOCITY_LOOKBACK_DAYS,
    SCORE_TIERS,
} from "./constants";
import type { ReputationTaskInput, CategoryScores, ReputationScoreData } from "./types";

const SUCCESS_STATUSES = new Set(["ACCEPTED", "AUTO_ACCEPTED", "AI_ACCEPTED", "RECTIFIED", "SETTLED"]);
const FAILURE_STATUSES = new Set(["DENIED", "MISSED"]);
const FINALIZED_STATUSES = new Set([...SUCCESS_STATUSES, ...FAILURE_STATUSES]);

interface RawCategoryScores {
    delivery: number | null;
    discipline: number | null;
    accountability: number | null;
    proofQuality: number | null;
    community: number | null;
}

function getTier(score: number): string {
    for (const tier of SCORE_TIERS) {
        if (score >= tier.minScore) return tier.label;
    }
    return SCORE_TIERS[SCORE_TIERS.length - 1].label;
}

function clampScore(score: number): number {
    return Math.min(1000, Math.max(0, score));
}

function bayesian(rawScore: number, taskCount: number): number {
    if (taskCount >= BAYESIAN_TASK_THRESHOLD) return rawScore;
    const fade = taskCount / BAYESIAN_TASK_THRESHOLD;
    const priorWeight = BAYESIAN_BASE_WEIGHT * (1 - fade);
    return (priorWeight * SCORE_BASE + taskCount * rawScore) / (priorWeight + taskCount);
}

function getFinalizedOwnedTasks(tasks: ReputationTaskInput[], userId: string): ReputationTaskInput[] {
    return tasks.filter((task) => task.user_id === userId && FINALIZED_STATUSES.has(task.status));
}

function getTaskEventTime(task: ReputationTaskInput): number {
    const candidates = [
        SUCCESS_STATUSES.has(task.status) ? task.marked_completed_at : null,
        task.deadline,
        task.updated_at,
        task.created_at,
    ];

    for (const value of candidates) {
        if (!value) continue;
        const parsed = new Date(value).getTime();
        if (!Number.isNaN(parsed)) return parsed;
    }

    return 0;
}

function computeDelivery(tasks: ReputationTaskInput[], userId: string): number | null {
    const finalized = getFinalizedOwnedTasks(tasks, userId);
    if (finalized.length === 0) return null;

    const successes = finalized.filter((task) => SUCCESS_STATUSES.has(task.status)).length;
    return (successes / finalized.length) * 1000;
}

function computeDiscipline(tasks: ReputationTaskInput[], userId: string): number | null {
    const recurring = getFinalizedOwnedTasks(tasks, userId).filter((task) => task.recurrence_rule_id != null);
    if (recurring.length === 0) return null;

    const groups = new Map<string, ReputationTaskInput[]>();
    for (const task of recurring) {
        const key = task.recurrence_rule_id!;
        const existing = groups.get(key) ?? [];
        existing.push(task);
        groups.set(key, existing);
    }

    let total = 0;
    for (const group of groups.values()) {
        const successes = group.filter((task) => SUCCESS_STATUSES.has(task.status)).length;
        total += (successes / group.length) * 1000;
    }

    return total / groups.size;
}

function computeAccountability(tasks: ReputationTaskInput[], userId: string): number | null {
    const finalized = getFinalizedOwnedTasks(tasks, userId);
    if (finalized.length === 0) return null;

    const now = Date.now();
    let weightedSuccess = 0;
    let totalWeight = 0;

    for (const task of finalized) {
        const ageInDays = Math.max(0, (now - getTaskEventTime(task)) / (1000 * 60 * 60 * 24));
        const weight = Math.pow(0.5, ageInDays / ACCOUNTABILITY_RECENCY_HALF_LIFE_DAYS);
        totalWeight += weight;
        if (SUCCESS_STATUSES.has(task.status)) {
            weightedSuccess += weight;
        }
    }

    if (totalWeight === 0) return null;
    return (weightedSuccess / totalWeight) * 1000;
}

function computeProofQuality(tasks: ReputationTaskInput[], userId: string): number | null {
    const proofEligible = tasks.filter(
        (task) =>
            task.user_id === userId &&
            task.voucher_id != null &&
            task.voucher_id !== userId &&
            task.marked_completed_at != null
    );
    if (proofEligible.length === 0) return null;

    const withProof = proofEligible.filter((task) => task.has_uploaded_proof).length;
    return (withProof / proofEligible.length) * 1000;
}

function computeCommunity(tasks: ReputationTaskInput[], userId: string): number | null {
    const vouchedFinalized = tasks.filter(
        (task) =>
            task.voucher_id === userId &&
            task.user_id !== userId &&
            FINALIZED_STATUSES.has(task.status)
    );
    if (vouchedFinalized.length === 0) return null;

    const reviewedWithoutTimeout = vouchedFinalized.filter((task) => !task.voucher_timeout_auto_accepted).length;
    return (reviewedWithoutTimeout / vouchedFinalized.length) * 1000;
}

function computeRawCategoryScores(tasks: ReputationTaskInput[], userId: string): RawCategoryScores {
    return {
        delivery: computeDelivery(tasks, userId),
        discipline: computeDiscipline(tasks, userId),
        accountability: computeAccountability(tasks, userId),
        proofQuality: computeProofQuality(tasks, userId),
        community: computeCommunity(tasks, userId),
    };
}

function coreScore(raw: RawCategoryScores): number {
    const slots: { value: number; weight: number }[] = [
        { value: raw.delivery ?? 0, weight: raw.delivery !== null ? WEIGHT_DELIVERY : 0 },
        { value: raw.accountability ?? 0, weight: raw.accountability !== null ? WEIGHT_ACCOUNTABILITY : 0 },
        { value: raw.discipline ?? 0, weight: raw.discipline !== null ? WEIGHT_DISCIPLINE : 0 },
        { value: raw.proofQuality ?? 0, weight: raw.proofQuality !== null ? WEIGHT_PROOF_QUALITY : 0 },
        { value: raw.community ?? 0, weight: raw.community !== null ? WEIGHT_COMMUNITY : 0 },
    ];

    const totalWeight = slots.reduce((sum, slot) => sum + slot.weight, 0);
    if (totalWeight === 0) return SCORE_BASE;

    return slots.reduce((sum, slot) => sum + slot.value * slot.weight, 0) / totalWeight;
}

function toCategoryScores(raw: RawCategoryScores): CategoryScores {
    return {
        delivery: raw.delivery ?? SCORE_BASE,
        discipline: raw.discipline ?? SCORE_BASE,
        accountability: raw.accountability ?? SCORE_BASE,
        proofQuality: raw.proofQuality ?? SCORE_BASE,
        community: raw.community ?? SCORE_BASE,
    };
}

function countOwnedFinalizedTasks(tasks: ReputationTaskInput[], userId: string): number {
    return getFinalizedOwnedTasks(tasks, userId).length;
}

function computeScoreForTasks(tasks: ReputationTaskInput[], userId: string): number {
    const raw = computeRawCategoryScores(tasks, userId);
    const finalizedCount = countOwnedFinalizedTasks(tasks, userId);
    return Math.round(clampScore(bayesian(coreScore(raw), finalizedCount)));
}

function computeVelocityDelta(tasks: ReputationTaskInput[], userId: string): number | null {
    const cutoff = Date.now() - VELOCITY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    const recentTasks = tasks.filter((task) => getTaskEventTime(task) >= cutoff);
    const tasksBeforeLookback = tasks.filter((task) => getTaskEventTime(task) < cutoff);

    if (countOwnedFinalizedTasks(recentTasks, userId) < 2 || countOwnedFinalizedTasks(tasksBeforeLookback, userId) < 2) {
        return null;
    }

    const currentScore = computeScoreForTasks(tasks, userId);
    const scoreBeforeLookback = computeScoreForTasks(tasksBeforeLookback, userId);
    return currentScore - scoreBeforeLookback;
}

export function computeFullReputationScore(
    tasks: ReputationTaskInput[],
    userId: string
): ReputationScoreData {
    const raw = computeRawCategoryScores(tasks, userId);
    const score = computeScoreForTasks(tasks, userId);

    return {
        score,
        tier: getTier(score),
        categoryScores: toCategoryScores(raw),
        taskCount: countOwnedFinalizedTasks(tasks, userId),
        velocityDelta: computeVelocityDelta(tasks, userId),
        computedAt: new Date().toISOString(),
    };
}
