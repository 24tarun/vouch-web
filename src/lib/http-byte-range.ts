export interface HttpByteRange {
    start: number;
    end: number;
}

/** Parse one RFC 9110 byte range. Multiple ranges are intentionally unsupported. */
export function parseHttpByteRange(rangeHeader: string, size: number): HttpByteRange | null {
    if (!Number.isSafeInteger(size) || size <= 0) return null;

    const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
    if (!match) return null;

    const [, rawStart, rawEnd] = match;
    if (!rawStart && !rawEnd) return null;

    if (!rawStart) {
        const suffixLength = Number(rawEnd);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
        return {
            start: Math.max(0, size - suffixLength),
            end: size - 1,
        };
    }

    const start = Number(rawStart);
    if (!Number.isSafeInteger(start) || start < 0 || start >= size) return null;

    const requestedEnd = rawEnd ? Number(rawEnd) : size - 1;
    if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return null;

    return {
        start,
        end: Math.min(requestedEnd, size - 1),
    };
}
