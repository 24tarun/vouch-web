const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Recurrence dates are stored as ISO date-only strings, so lexical order is
 * chronological order. A cursor in the future means that occurrence was
 * already materialized when the recurring series was created.
 */
export function isRecurrenceDateAlreadyGenerated(
    lastGeneratedDate: string | null | undefined,
    candidateDate: string
): boolean {
    if (!lastGeneratedDate) return false;
    if (!DATE_ONLY_PATTERN.test(lastGeneratedDate) || !DATE_ONLY_PATTERN.test(candidateDate)) {
        return false;
    }

    return lastGeneratedDate >= candidateDate;
}
