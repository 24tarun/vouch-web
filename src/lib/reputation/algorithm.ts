import {
    SCORE_BASE,
    BAYESIAN_BASE_WEIGHT,
    BAYESIAN_TASK_THRESHOLD,
    WEIGHT_DELIVERY,
    WEIGHT_ACCOUNTABILITY,
    WEIGHT_COMMUNITY,
    STREAK_MULTIPLIERS,
    CONSECUTIVE_FAILURE_MULTIPLIERS,
    ACCOUNTABILITY_FAILURE_PENALTY,
    ACCOUNTABILITY_DECAY_HALF_LIFE_DAYS,
    ACCOUNTABILITY_CONSECUTIVE_WINDOW_DAYS,
    COMMUNITY_AUTO_ACCEPT_PENALTY,
    COMMUNITY_VOUCH_REWARD,
    DISCIPLINE_BONUS_MAX,
    PROOF_BONUS_MAX,
    POMO_POINTS_PER_10_MIN,
    POMO_BONUS_MAX,
    VELOCITY_LOOKBACK_DAYS,
    SCORE_TIERS,
} from "./constants";
import type { ReputationTaskInput, CategoryScores, ReputationScoreData } from "./types";

const SUCCESS_STATUSES = new Set(["COMPLETED", "RECTIFIED", "SETTLED"]);
const FINALIZED_STATUSES = new Set(["COMPLETED", "RECTIFIED", "SETTLED", "FAILED"]);

function getTier(score: number): string {
    for (const tier of SCORE_TIERS) {
        if (score >= tier.minScore) return tier.label;
    }
    return SCORE_TIERS[SCORE_TIERS.length - 1].label;
}

function bayesian(rawScore: number, taskCount: number): number {
    if (taskCount >= BAYESIAN_TASK_THRESHOLD) return rawScore;
    const t = taskCount / BAYESIAN_TASK_THRESHOLD; // 0→1 as tasks accumulate
    const effectiveWeight = BAYESIAN_BASE_WEIGHT * (1 - t);
    return (effectiveWeight * SCORE_BASE + taskCount * rawScore) / (effectiveWeight + taskCount);
}

function getStreakMultiplier(streakDays: number): number {
    for (const { minDays, mult } of STREAK_MULTIPLIERS) {
        if (streakDays >= minDays) return mult;
    }
    return 1.0;
}

// Returns null when no data — caller excludes from weighted average
function computeDelivery(tasks: ReputationTaskInput[]): number | null {
    const finalized = tasks.filter((t) => FINALIZED_STATUSES.has(t.status));
    if (finalized.length === 0) return null;
    const completed = finalized.filter((t) => SUCCESS_STATUSES.has(t.status) && t.marked_completed_at != null);
    return (completed.length / finalized.length) * 1000;
}

function computeDiscipline(tasks: ReputationTaskInput[]): number | null {
    const recurring = tasks.filter((t) => t.recurrence_rule_id != null);
    if (recurring.length === 0) return null;

    const groups = new Map<string, ReputationTaskInput[]>();
    for (const t of recurring) {
        const key = t.recurrence_rule_id!;
        const arr = groups.get(key) ?? [];
        arr.push(t);
        groups.set(key, arr);
    }

    let totalContribution = 0;

    for (const group of groups.values()) {
        const sorted = group
            .filter((t) => FINALIZED_STATUSES.has(t.status))
            .sort((a, b) => {
                const da = a.deadline ? new Date(a.deadline).getTime() : new Date(a.updated_at).getTime();
                const db = b.deadline ? new Date(b.deadline).getTime() : new Date(b.updated_at).getTime();
                return da - db;
            });

        if (sorted.length === 0) continue;

        let streakDays = 0;
        let contribution = 0;

        for (const t of sorted) {
            if (SUCCESS_STATUSES.has(t.status)) {
                streakDays++;
                const mult = getStreakMultiplier(streakDays);
                contribution += Math.min(1000, (1000 * mult) / sorted.length);
            } else {
                const penalty = streakDays > 0 ? 200 : 400;
                contribution = Math.max(0, contribution - penalty);
                streakDays = 0;
            }
        }

        totalContribution += Math.min(1000, contribution);
    }

    return Math.min(1000, totalContribution / groups.size);
}

function computeAccountability(tasks: ReputationTaskInput[]): number | null {
    const finalized = tasks.filter((t) => FINALIZED_STATUSES.has(t.status));
    if (finalized.length === 0) return null;

    const sorted = [...tasks].sort(
        (a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
    );

    let score = 1000;
    let consecutiveFailures = 0;
    let lastFailureDate: Date | null = null;
    const now = new Date();

    for (const t of sorted) {
        const ageInDays = (now.getTime() - new Date(t.updated_at).getTime()) / (1000 * 60 * 60 * 24);
        const decayFactor = Math.pow(0.5, ageInDays / ACCOUNTABILITY_DECAY_HALF_LIFE_DAYS);

        if (t.status === "FAILED") {
            const taskDate = new Date(t.updated_at);
            const inWindow =
                lastFailureDate != null &&
                (taskDate.getTime() - lastFailureDate.getTime()) / (1000 * 60 * 60 * 24) <=
                    ACCOUNTABILITY_CONSECUTIVE_WINDOW_DAYS;

            if (inWindow) {
                consecutiveFailures = Math.min(consecutiveFailures + 1, CONSECUTIVE_FAILURE_MULTIPLIERS.length - 1);
            } else {
                consecutiveFailures = 0;
            }

            const mult = CONSECUTIVE_FAILURE_MULTIPLIERS[consecutiveFailures];
            score -= ACCOUNTABILITY_FAILURE_PENALTY * decayFactor * mult;
            lastFailureDate = taskDate;
        } else if (SUCCESS_STATUSES.has(t.status)) {
            consecutiveFailures = 0;
            lastFailureDate = null;
        }

    }

    return Math.min(1000, Math.max(0, score));
}

function computeProofQuality(tasks: ReputationTaskInput[], userId: string): number | null {
    const eligible = tasks.filter(
        (t) =>
            t.user_id === userId &&
            SUCCESS_STATUSES.has(t.status) &&
            t.marked_completed_at != null &&
            t.voucher_id !== userId
    );
    if (eligible.length === 0) return null;
    const withProof = eligible.filter((t) => t.has_uploaded_proof);
    return (withProof.length / eligible.length) * 1000;
}

function computeCommunity(tasks: ReputationTaskInput[], userId: string): number | null {
    const vouchedTasks = tasks.filter((t) => t.voucher_id === userId && t.user_id !== userId);
    if (vouchedTasks.length === 0) return null;

    let score = 1000;
    for (const t of vouchedTasks) {
        if (FINALIZED_STATUSES.has(t.status)) {
            score += COMMUNITY_VOUCH_REWARD;
        }
        if (t.voucher_timeout_auto_accepted) {
            score -= COMMUNITY_AUTO_ACCEPT_PENALTY;
        }
    }

    return Math.min(1000, Math.max(0, score));
}

interface RawCategoryScores {
    delivery: number | null;
    discipline: number | null;
    accountability: number | null;
    proofQuality: number | null;
    community: number | null;
}

function computeRawCategoryScores(tasks: ReputationTaskInput[], userId: string): RawCategoryScores {
    return {
        delivery: computeDelivery(tasks),
        discipline: computeDiscipline(tasks),
        accountability: computeAccountability(tasks),
        proofQuality: computeProofQuality(tasks, userId),
        community: computeCommunity(tasks, userId),
    };
}

// Core score: delivery + accountability + community, weights redistributed among active categories.
// Discipline and proof quality are additive bonuses — never penalise for not using them.
function coreScore(raw: RawCategoryScores): number {
    const slots: { value: number; weight: number }[] = [
        { value: raw.delivery ?? 0, weight: raw.delivery !== null ? WEIGHT_DELIVERY : 0 },
        { value: raw.accountability ?? 0, weight: raw.accountability !== null ? WEIGHT_ACCOUNTABILITY : 0 },
        { value: raw.community ?? 0, weight: raw.community !== null ? WEIGHT_COMMUNITY : 0 },
    ];

    const totalWeight = slots.reduce((s, c) => s + c.weight, 0);
    if (totalWeight === 0) return SCORE_BASE;

    return slots.reduce((s, c) => s + c.value * c.weight, 0) / totalWeight;
}

// Bonus points on top of core score — only awarded when the feature is used
function bonusPoints(raw: RawCategoryScores, tasks: ReputationTaskInput[], userId: string): number {
    const disciplineBonus =
        raw.discipline !== null ? (raw.discipline / 1000) * DISCIPLINE_BONUS_MAX : 0;
    const proofBonus =
        raw.proofQuality !== null ? (raw.proofQuality / 1000) * PROOF_BONUS_MAX : 0;

    // Pomo: 1 point per 10 minutes of pomo time on owned completed tasks, capped at POMO_BONUS_MAX
    const completedOwned = tasks.filter(
        (t) => t.user_id === userId && SUCCESS_STATUSES.has(t.status) && t.pomo_total_seconds > 0
    );
    const totalPomoMinutes = completedOwned.reduce((s, t) => s + t.pomo_total_seconds / 60, 0);
    const pomoBonus = Math.min(POMO_BONUS_MAX, totalPomoMinutes * (POMO_POINTS_PER_10_MIN / 10));

    return disciplineBonus + proofBonus + pomoBonus;
}

// Map raw (nullable) scores to CategoryScores for display — null shows as SCORE_BASE
function toCategoryScores(raw: RawCategoryScores): CategoryScores {
    return {
        delivery: raw.delivery ?? SCORE_BASE,
        discipline: raw.discipline ?? SCORE_BASE,
        accountability: raw.accountability ?? SCORE_BASE,
        proofQuality: raw.proofQuality ?? SCORE_BASE,
        community: raw.community ?? SCORE_BASE,
    };
}

export function computeFullReputationScore(
    tasks: ReputationTaskInput[],
    userId: string
): ReputationScoreData {
    const ownedTasks = tasks.filter((t) => t.user_id === userId);
    const finalizedCount = ownedTasks.filter((t) => FINALIZED_STATUSES.has(t.status)).length;

    const raw = computeRawCategoryScores(tasks, userId);
    const rawScore = coreScore(raw) + bonusPoints(raw, tasks, userId); // cap applied after Bayesian so bonuses have real effect
    const score = Math.round(Math.min(1000, Math.max(0, bayesian(rawScore, finalizedCount))));

    // Velocity: re-run with tasks older than 7 days
    let velocityDelta: number | null = null;
    const cutoff = new Date(Date.now() - VELOCITY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const historicalTasks = tasks.filter((t) => new Date(t.updated_at) < cutoff);
    const historicalOwned = historicalTasks.filter((t) => t.user_id === userId);
    const historicalFinalizedCount = historicalOwned.filter((t) => FINALIZED_STATUSES.has(t.status)).length;

    if (historicalFinalizedCount >= 2) {
        const historicalRaw = computeRawCategoryScores(historicalTasks, userId);
        const historicalRawScore = coreScore(historicalRaw) + bonusPoints(historicalRaw, historicalTasks, userId);
        const historicalScore = Math.round(
            Math.min(1000, Math.max(0, bayesian(historicalRawScore, historicalFinalizedCount)))
        );
        velocityDelta = score - historicalScore;
    }

    return {
        score,
        tier: getTier(score),
        categoryScores: toCategoryScores(raw),
        taskCount: finalizedCount,
        velocityDelta,
        computedAt: new Date().toISOString(),
    };
}
