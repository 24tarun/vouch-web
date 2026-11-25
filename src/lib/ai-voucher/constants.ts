
export const AI_PROFILE_ID = "11111111-1111-1111-1111-111111111111";

export const AI_VOUCHER_REPUTATION_MULTIPLIER = 0.5;

export const AI_VOUCHER_DISPLAY_NAME = "AI";

export function isAiVouched(task: { voucher_id: string }): boolean {
  return task.voucher_id === AI_PROFILE_ID;
}

export function isAiVouchedOrEscalated(task: {
  voucher_id: string | null;
  ai_escalated_from?: boolean;
}): boolean {
  return task.voucher_id === AI_PROFILE_ID || Boolean(task.ai_escalated_from);
}
