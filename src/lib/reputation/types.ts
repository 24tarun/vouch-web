export interface ReputationTaskInput {
    id: string;
    user_id: string;
    voucher_id: string | null;
    status: string;
    deadline: string | null;
    created_at: string;
    updated_at: string;
    marked_completed_at: string | null;
    postponed_at: string | null;
    recurrence_rule_id: string | null;
    voucher_timeout_auto_accepted: boolean | null;
    has_uploaded_proof: boolean;
    pomo_total_seconds: number;
}

export interface CategoryScores {
    delivery: number;
    discipline: number;
    accountability: number;
    proofQuality: number;
    community: number;
}

export interface ReputationScoreData {
    score: number;
    tier: string;
    categoryScores: CategoryScores;
    taskCount: number;
    velocityDelta: number | null;
    computedAt: string;
}
