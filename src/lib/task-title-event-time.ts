import { parseClockToken } from "@/lib/task-title-parser";
import type { ParsedClockToken } from "@/lib/task-title-parser";
export { parseClockToken };
export type { ParsedClockToken };

const EVENT_TOKEN_REGEX = /(^|\s)-event(?=\s|$)/i;
const EVENT_START_TOKEN_REGEX = /(^|\s)(?:-start|-s|\.s)\s*(\d{1,2}:\d{2}(?:\s*(?:am|pm))?|\d{1,4}(?:\s*(?:am|pm))?|\d{1,2}(?:\s*(?:am|pm))?)\b/gi;
const EVENT_END_TOKEN_REGEX = /(^|\s)(?:-end|-e|\.e)\s*(\d{1,2}:\d{2}(?:\s*(?:am|pm))?|\d{1,4}(?:\s*(?:am|pm))?|\d{1,2}(?:\s*(?:am|pm))?)\b/gi;
const EVENT_AT_TIME_TOKEN_REGEX = /@(\d{1,2}:\d{2}(?:\s*(?:am|pm))?|\d{1,4}(?:\s*(?:am|pm))?|\d{1,2}(?:\s*(?:am|pm))?)\b/i;

const EVENT_DUPLICATE_START_ERROR = "Use only one -start token.";
const EVENT_DUPLICATE_END_ERROR = "Use only one -end token.";
const EVENT_MISSING_TIME_ERROR = "Event tasks require both -startHHMM and -endHHMM.";
const EVENT_START_INVALID_ERROR = "Event start time is invalid. Use -start930 or -start09:30.";
const EVENT_END_INVALID_ERROR = "Event end time is invalid. Use -end930 or -end15:00.";
const EVENT_END_BEFORE_START_ERROR = "Event end time must be after start time.";

export interface ExtractedEventTokens {
    hasEvent: boolean;
    startToken?: string;
    endToken?: string;
    errors: string[];
}

export interface ResolveEventScheduleOptions {
    rawTitle: string;
    anchorDate: Date;
    defaultDurationMinutes: number;
    now?: Date;
}

export interface ResolveEventScheduleResult {
    hasEvent: boolean;
    startDate: Date | null;
    endDate: Date | null;
    error?: string;
}

export function extractEventTokens(rawTitle: string): ExtractedEventTokens {
    const hasEvent = EVENT_TOKEN_REGEX.test(rawTitle);
    const errors: string[] = [];
    let startToken: string | undefined;
    let endToken: string | undefined;

    const startRegex = new RegExp(EVENT_START_TOKEN_REGEX.source, "gi");
    const endRegex = new RegExp(EVENT_END_TOKEN_REGEX.source, "gi");

    const startMatches = Array.from(rawTitle.matchAll(startRegex));
    const endMatches = Array.from(rawTitle.matchAll(endRegex));

    if (startMatches.length > 1) {
        errors.push(EVENT_DUPLICATE_START_ERROR);
    } else if (startMatches.length === 1) {
        startToken = startMatches[0][2];
    }

    if (endMatches.length > 1) {
        errors.push(EVENT_DUPLICATE_END_ERROR);
    } else if (endMatches.length === 1) {
        endToken = endMatches[0][2];
    }

    return {
        hasEvent,
        startToken,
        endToken,
        errors,
    };
}

function applyClockToken(baseDate: Date, token: ParsedClockToken): Date {
    const next = new Date(baseDate);
    next.setHours(token.hours, token.minutes, 0, 0);
    return next;
}

export function resolveEventSchedule(options: ResolveEventScheduleOptions): ResolveEventScheduleResult {
    const { rawTitle, anchorDate, defaultDurationMinutes } = options;

    if (
        !(anchorDate instanceof Date) ||
        Number.isNaN(anchorDate.getTime()) ||
        !Number.isInteger(defaultDurationMinutes) ||
        defaultDurationMinutes < 1
    ) {
        return {
            hasEvent: false,
            startDate: null,
            endDate: null,
            error: EVENT_START_INVALID_ERROR,
        };
    }

    const extracted = extractEventTokens(rawTitle);
    if (!extracted.hasEvent) {
        return {
            hasEvent: false,
            startDate: null,
            endDate: null,
        };
    }

    if (extracted.errors.length > 0) {
        return {
            hasEvent: true,
            startDate: null,
            endDate: null,
            error: extracted.errors[0],
        };
    }

    const atTimeMatch = rawTitle.match(EVENT_AT_TIME_TOKEN_REGEX);
    const atTimeToken = atTimeMatch?.[1];
    const endToken = extracted.endToken ?? atTimeToken;

    if (extracted.endToken && atTimeToken) {
        return {
            hasEvent: true,
            startDate: null,
            endDate: null,
            error: EVENT_DUPLICATE_END_ERROR,
        };
    }

    if (!extracted.startToken || !endToken) {
        return {
            hasEvent: true,
            startDate: null,
            endDate: null,
            error: EVENT_MISSING_TIME_ERROR,
        };
    }

    const parsedStart = extracted.startToken ? parseClockToken(extracted.startToken) : null;
    const parsedEnd = endToken ? parseClockToken(endToken) : null;

    if (extracted.startToken && !parsedStart) {
        return {
            hasEvent: true,
            startDate: null,
            endDate: null,
            error: EVENT_START_INVALID_ERROR,
        };
    }

    if (endToken && !parsedEnd) {
        return {
            hasEvent: true,
            startDate: null,
            endDate: null,
            error: EVENT_END_INVALID_ERROR,
        };
    }

    let startDate: Date;
    let endDate: Date;

    if (parsedStart && parsedEnd) {
        startDate = applyClockToken(anchorDate, parsedStart);
        endDate = applyClockToken(anchorDate, parsedEnd);
    } else {
        return {
            hasEvent: true,
            startDate: null,
            endDate: null,
            error: EVENT_MISSING_TIME_ERROR,
        };
    }

    if (endDate.getTime() <= startDate.getTime()) {
        return {
            hasEvent: true,
            startDate: null,
            endDate: null,
            error: EVENT_END_BEFORE_START_ERROR,
        };
    }

    return {
        hasEvent: true,
        startDate,
        endDate,
    };
}
