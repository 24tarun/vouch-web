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

/**
 * How long after an attested capture the upload may still land. Generous because
 * a large video on a poor connection, or an upload resumed after the app was
 * killed, is normal use rather than an abuse signal.
 */
export const CAPTURE_UPLOAD_WINDOW_MS = 15 * 60 * 1000;

/**
 * Whether a locally recorded capture start falls inside the window its license
 * authorized.
 *
 * Kept separate from signature verification so the policy is testable without
 * crypto. The signature is what makes `notBefore`/`notAfter` trustworthy; this
 * decides whether the device's claimed instant is allowed to sit between them,
 * and that the upload has not been banked for later.
 */
export function isCaptureStartWithinLicense(
  license: { notBefore: string; notAfter: string },
  claimedStartedAtMs: number,
  nowMs = Date.now(),
): boolean {
  const notBeforeMs = new Date(license.notBefore).getTime();
  const notAfterMs = new Date(license.notAfter).getTime();

  if (!Number.isFinite(notBeforeMs) || !Number.isFinite(notAfterMs)) return false;
  if (!Number.isFinite(claimedStartedAtMs)) return false;
  if (claimedStartedAtMs < notBeforeMs || claimedStartedAtMs > notAfterMs) return false;

  return nowMs - claimedStartedAtMs <= CAPTURE_UPLOAD_WINDOW_MS;
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
