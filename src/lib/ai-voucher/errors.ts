export function describeAiEvaluationError(error: unknown): string {
    if (error instanceof Error) return error.message;

    if (error && typeof error === 'object') {
        const message = (error as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim()) return message;

        try {
            return JSON.stringify(error);
        } catch {
            // Fall through to the best available string representation.
        }
    }

    return String(error);
}
