export const SCORE_BASE = 400;
export const BAYESIAN_BASE_WEIGHT = 20;

export const WEIGHT_DELIVERY = 0.35;
export const WEIGHT_DISCIPLINE = 0.25;
export const WEIGHT_ACCOUNTABILITY = 0.20;
export const WEIGHT_PROOF_QUALITY = 0.10;
export const WEIGHT_COMMUNITY = 0.10;

export const STREAK_MULTIPLIERS: { minDays: number; mult: number }[] = [
    { minDays: 30, mult: 2.0 },
    { minDays: 14, mult: 1.6 },
    { minDays: 7, mult: 1.3 },
    { minDays: 1, mult: 1.0 },
];

export const CONSECUTIVE_FAILURE_MULTIPLIERS = [1.0, 1.5, 2.0, 2.5];

export const ACCOUNTABILITY_FAILURE_PENALTY = 80;
export const ACCOUNTABILITY_POSTPONE_PENALTY = 25;
export const ACCOUNTABILITY_DECAY_HALF_LIFE_DAYS = 90;
export const ACCOUNTABILITY_CONSECUTIVE_WINDOW_DAYS = 30;

export const DISCIPLINE_HEAVY_BREAK_THRESHOLD_DAYS = 15;

export const COMMUNITY_AUTO_ACCEPT_PENALTY = 30;
export const COMMUNITY_VOUCH_REWARD = 15;

export const DISCIPLINE_BONUS_MAX = 75;
export const PROOF_BONUS_MAX = 50;
export const POMO_POINTS_PER_10_MIN = 1;
export const POMO_BONUS_MAX = 50;

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
