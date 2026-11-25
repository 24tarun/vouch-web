const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
