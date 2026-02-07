"use client";

import { toast } from "sonner";

type MaybeErrorResult = {
    error?: string | null;
};

interface RunOptimisticMutationOptions<TSnapshot, TResult> {
    captureSnapshot: () => TSnapshot;
    applyOptimistic: (snapshot: TSnapshot) => void;
    runMutation: () => Promise<TResult>;
    rollback: (snapshot: TSnapshot) => void;
    onSuccess?: (result: TResult, snapshot: TSnapshot) => void | Promise<void>;
    getFailureMessage?: (result: TResult) => string | null;
    fallbackErrorMessage?: string;
}

export interface OptimisticMutationResponse<TResult> {
    ok: boolean;
    result?: TResult;
    error?: string;
}

function getErrorMessage(error: unknown, fallbackErrorMessage: string): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return fallbackErrorMessage;
}

function getResultError<TResult>(result: TResult): string | null {
    if (!result || typeof result !== "object") {
        return null;
    }
    const maybeError = result as MaybeErrorResult;
    return maybeError.error || null;
}

export async function runOptimisticMutation<TSnapshot, TResult>({
    captureSnapshot,
    applyOptimistic,
    runMutation,
    rollback,
    onSuccess,
    getFailureMessage,
    fallbackErrorMessage = "Couldn't save changes. Reverting...",
}: RunOptimisticMutationOptions<TSnapshot, TResult>): Promise<OptimisticMutationResponse<TResult>> {
    const snapshot = captureSnapshot();
    applyOptimistic(snapshot);

    try {
        const result = await runMutation();
        const failureMessage =
            getFailureMessage?.(result) ??
            getResultError(result);

        if (failureMessage) {
            rollback(snapshot);
            toast.error(failureMessage);
            return { ok: false, result, error: failureMessage };
        }

        if (onSuccess) {
            await onSuccess(result, snapshot);
        }

        return { ok: true, result };
    } catch (error) {
        const errorMessage = getErrorMessage(error, fallbackErrorMessage);
        rollback(snapshot);
        toast.error(errorMessage);
        return { ok: false, error: errorMessage };
    }
}
