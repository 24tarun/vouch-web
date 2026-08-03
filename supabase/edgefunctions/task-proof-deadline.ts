export const DEADLINE_INCLUSIVE_MINUTE_MS = 60 * 1000;
export const COMPLETION_EDIT_LOCKED_ERROR = 'The task deadline has passed. Proof and completion can no longer be changed.';

const COMPLETION_EDITABLE_STATUSES = new Set([
  'ACTIVE',
  'POSTPONED',
  'AWAITING_VOUCHER',
  'AWAITING_AI',
  'MARKED_COMPLETE',
]);

export function isCompletionEditingLocked(
  status: string,
  deadline: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!COMPLETION_EDITABLE_STATUSES.has(status)) return false;

  const deadlineMs = typeof deadline === 'string' ? new Date(deadline).getTime() : NaN;
  if (!Number.isFinite(deadlineMs)) return true;

  return nowMs >= deadlineMs + DEADLINE_INCLUSIVE_MINUTE_MS;
}

export function canMarkProofUploadFailed(uploadState: string | null | undefined): boolean {
  return uploadState === 'PENDING';
}

export function wasProofStagedBeforeCompletionLock(
  deadline: string | null | undefined,
  stagedAt: string | null | undefined,
): boolean {
  const deadlineMs = typeof deadline === 'string' ? new Date(deadline).getTime() : NaN;
  const stagedAtMs = typeof stagedAt === 'string' ? new Date(stagedAt).getTime() : NaN;
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(stagedAtMs)) return false;

  return stagedAtMs < deadlineMs + DEADLINE_INCLUSIVE_MINUTE_MS;
}
