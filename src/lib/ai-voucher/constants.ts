/**
 * AI Voucher Constants
 *
 * AI is a system user that acts as an AI voucher for tasks requiring proof.
 * All identifiers here must match the AI voucher identity migration.
 */

// Stable UUID for AI system user
export const AI_PROFILE_ID = "00000000-0000-0000-0000-000000000001";

// AI-vouched tasks count at 0.5x reputation weight vs human-vouched (no discount for denials)
export const AI_VOUCHER_REPUTATION_MULTIPLIER = 0.5;

// Display name for the AI voucher
export const AI_VOUCHER_DISPLAY_NAME = "AI";

/**
 * Check if a task is currently AI-vouched
 */
export function isAiVouched(task: { voucher_id: string }): boolean {
  return task.voucher_id === AI_PROFILE_ID;
}

/**
 * Check if a task is AI-vouched OR was originally AI-vouched and escalated to a human.
 * Both cases retain the 0.5x reputation weight.
 */
export function isAiVouchedOrEscalated(task: {
  voucher_id: string | null;
  ai_escalated_from?: boolean;
}): boolean {
  return task.voucher_id === AI_PROFILE_ID || Boolean(task.ai_escalated_from);
}


