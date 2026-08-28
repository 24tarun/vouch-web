import { z } from "zod";

export const LIFEBENCH_MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

const isoDateTimeSchema = z.iso.datetime({ offset: true });

export interface LifebenchTaskRange {
    from: string;
    to: string;
}

export type LifebenchTaskRangeResult =
    | { range: LifebenchTaskRange; error: null }
    | { range: null; error: string };

export function parseLifebenchTaskRange(
    searchParams: URLSearchParams
): LifebenchTaskRangeResult {
    const fromInput = searchParams.get("from");
    const toInput = searchParams.get("to");

    if (!fromInput || !toInput) {
        return {
            range: null,
            error: "Both from and to are required ISO 8601 timestamps with a timezone.",
        };
    }

    if (
        !isoDateTimeSchema.safeParse(fromInput).success ||
        !isoDateTimeSchema.safeParse(toInput).success
    ) {
        return {
            range: null,
            error: "from and to must be valid ISO 8601 timestamps with a timezone.",
        };
    }

    const fromMs = new Date(fromInput).getTime();
    const toMs = new Date(toInput).getTime();

    if (toMs <= fromMs) {
        return { range: null, error: "to must be later than from." };
    }

    if (toMs - fromMs > LIFEBENCH_MAX_RANGE_MS) {
        return {
            range: null,
            error: "The requested range cannot be longer than 366 days.",
        };
    }

    return {
        range: {
            from: new Date(fromMs).toISOString(),
            to: new Date(toMs).toISOString(),
        },
        error: null,
    };
}
