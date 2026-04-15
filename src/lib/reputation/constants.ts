export const SCORE_BASE = 400;
export const BAYESIAN_BASE_WEIGHT = 10;
export const BAYESIAN_TASK_THRESHOLD = 40; // Prior fades as finalized history accumulates

export const WEIGHT_DELIVERY = 0.4;
export const WEIGHT_ACCOUNTABILITY = 0.25;
export const WEIGHT_DISCIPLINE = 0.15;
export const WEIGHT_PROOF_QUALITY = 0.1;
export const WEIGHT_COMMUNITY = 0.1;

export const ACCOUNTABILITY_RECENCY_HALF_LIFE_DAYS = 21;

export const VELOCITY_LOOKBACK_DAYS = 7;

export const SCORE_TIERS: { minScore: number; label: string }[] = [
    { minScore: 900, label: "Legendary" },
    { minScore: 800, label: "Elite" },
    { minScore: 700, label: "Trusted" },
    { minScore: 600, label: "Solid" },
    { minScore: 500, label: "Rising" },
    { minScore: 400, label: "New Here" },
    { minScore: 300, label: "Shaky" },
    { minScore: 200, label: "Struggling" },
    { minScore: 0, label: "Unreliable" },
];
