import type { CSSProperties } from "react";
import type { Profile } from "@/lib/types";
import { MAX_POMO_DURATION_MINUTES } from "@/lib/constants";
import {
    extractEventColorMatches,
    GOOGLE_EVENT_COLOR_OPTIONS,
} from "@/lib/task-title-event-color";

// ---------------------------------------------------------------------------
// Weekday (merged from task-title-weekday.ts)
// ---------------------------------------------------------------------------

const WEEKDAY_TOKEN_PATTERN =
    "\\b(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\\b";

export const WEEKDAY_TOKEN_REGEX = new RegExp(WEEKDAY_TOKEN_PATTERN, "gi");

export interface WeekdayTokenMatch {
    token: string;
    weekday: number;
    index: number;
}

function mapWeekdayTokenToIndex(token: string): number {
    const normalized = token.toLowerCase();
    if (normalized.startsWith("mon")) return 1;
    if (normalized.startsWith("tue")) return 2;
    if (normalized.startsWith("wed")) return 3;
    if (normalized.startsWith("thu")) return 4;
    if (normalized.startsWith("fri")) return 5;
    if (normalized.startsWith("sat")) return 6;
    return 0;
}

export function extractWeekdayDateTokens(text: string): WeekdayTokenMatch[] {
    const matches: WeekdayTokenMatch[] = [];
    const regex = new RegExp(WEEKDAY_TOKEN_PATTERN, "gi");
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
        matches.push({
            token: match[1],
            weekday: mapWeekdayTokenToIndex(match[1]),
            index: match.index,
        });
    }

    return matches.sort((a, b) => a.index - b.index);
}

export function resolveUpcomingWeekdayDate(targetWeekday: number, now: Date): Date {
    const offset = (targetWeekday - now.getDay() + 7) % 7;
    const resolved = new Date(now);
    resolved.setDate(resolved.getDate() + offset);
    return resolved;
}

// ---------------------------------------------------------------------------
// Overlay gate (merged from task-title-overlay.ts)
// ---------------------------------------------------------------------------

export interface TaskTitleOverlaySegment {
    className: string;
    style?: {
        color?: string;
    };
}

export function shouldRenderTaskTitleOverlay(
    title: string,
    segments: TaskTitleOverlaySegment[],
    completionSuffix?: string
): boolean {
    if (!title) return false;
    if (completionSuffix) return true;

    return segments.some((segment) => segment.className !== "text-white" || Boolean(segment.style?.color));
}

// ---------------------------------------------------------------------------
// Clock / time token parsing (unified — replaces both parseClockToken and
// parseTaskInputTimeToken which were duplicates with different allowHourOnly defaults)
// ---------------------------------------------------------------------------

export interface ParsedClockToken {
    hours: number;
    minutes: number;
}

export function parseTaskInputTimeToken(token: string, allowHourOnly: boolean): ParsedClockToken | null {
    const normalized = token.trim().toLowerCase();

    const amPmMatch = normalized.match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)$/i);
    if (amPmMatch) {
        let hours = Number.parseInt(amPmMatch[1], 10);
        const minutes = amPmMatch[2] ? Number.parseInt(amPmMatch[2], 10) : 0;
        const meridiem = amPmMatch[3].toLowerCase();

        if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;
        if (meridiem === "pm" && hours < 12) hours += 12;
        if (meridiem === "am" && hours === 12) hours = 0;
        return { hours, minutes };
    }

    let hours = Number.NaN;
    let minutes = Number.NaN;

    const colonMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);
    if (colonMatch) {
        hours = Number.parseInt(colonMatch[1], 10);
        minutes = Number.parseInt(colonMatch[2], 10);
    } else {
        const compactFourMatch = normalized.match(/^(\d{4})$/);
        if (compactFourMatch) {
            hours = Number.parseInt(compactFourMatch[1].slice(0, 2), 10);
            minutes = Number.parseInt(compactFourMatch[1].slice(2, 4), 10);
        } else {
            const compactThreeMatch = normalized.match(/^(\d{3})$/);
            if (compactThreeMatch) {
                hours = Number.parseInt(compactThreeMatch[1].slice(0, 1), 10);
                minutes = Number.parseInt(compactThreeMatch[1].slice(1, 3), 10);
            } else if (allowHourOnly) {
                const hourOnlyMatch = normalized.match(/^(\d{1,2})$/);
                if (hourOnlyMatch) {
                    hours = Number.parseInt(hourOnlyMatch[1], 10);
                    minutes = 0;
                }
            }
        }
    }

    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

    return { hours, minutes };
}

/** Alias used by task-title-event-time.ts — always allows hour-only input. */
export function parseClockToken(raw: string): ParsedClockToken | null {
    return parseTaskInputTimeToken(raw, true);
}

// ---------------------------------------------------------------------------
// Highlight segments + keyword completion (merged from task-input-editor.ts)
// ---------------------------------------------------------------------------

export const EVENT_TOKEN_REGEX = /(^|\s)-event(?=\s|$)/i;
const HIGHLIGHT_EVENT_TOKEN_REGEX = /(^|\s)(-event)(?=\s|$)/gi;
const HIGHLIGHT_TIME_TOKEN_REGEX = /(^|\s)(@(\d{1,2}:\d{2}(?:\s*(?:am|pm))?|\d{1,4}(?:\s*(?:am|pm))?|\d{1,2}(?:\s*(?:am|pm))?))\b/gi;
const HIGHLIGHT_EVENT_START_TOKEN_REGEX = /(^|\s)(-start\s*(\d{1,2}:\d{2}(?:\s*(?:am|pm))?|\d{1,4}(?:\s*(?:am|pm))?|\d{1,2}(?:\s*(?:am|pm))?))\b/gi;
const HIGHLIGHT_EVENT_END_TOKEN_REGEX = /(^|\s)(-end\s*(\d{1,2}:\d{2}(?:\s*(?:am|pm))?|\d{1,4}(?:\s*(?:am|pm))?|\d{1,2}(?:\s*(?:am|pm))?))\b/gi;
const HIGHLIGHT_EVENT_COLOR_HELPER_TOKEN_REGEX = /(^|\s)(-color)(?=\s|$)/gi;
const HIGHLIGHT_PROOF_TOKEN_REGEX = /(^|\s)(-proof)(?=\s|$)/gi;
const HIGHLIGHT_TIMER_TOKEN_REGEX = /\b(timer)\s+(\d+)\b/gi;
const HIGHLIGHT_POMO_TOKEN_REGEX = /\b(pomo)\s+(\d+)\b/gi;
const HIGHLIGHT_REMIND_TOKEN_REGEX = /(^|\s)(remind@(\d{1,2}:\d{2}(?:\s*(?:am|pm))?|\d{1,4}(?:\s*(?:am|pm))?|\d{1,2}(?:\s*(?:am|pm))?))\b/gi;
const HIGHLIGHT_REPEAT_TOKEN_REGEX = /\b(repeat)\s+(daily|weekly|monthly|yearly)\b/gi;
const HIGHLIGHT_TOMORROW_TOKEN_REGEX = /\b(tmr|tmrw|tomorrow)\b/gi;
const HIGHLIGHT_VOUCH_TOKEN_REGEX = /(^|\s)(vouch|\.v)\s+(me|self|myself|[^\s/]+)(?=\s|$|\/)/gi;
const HIGHLIGHT_ORDINAL_DATE_TOKEN_REGEX = /\b([12]?\d|3[01])(st|nd|rd|th)\b/gi;
const HIGHLIGHT_SLASH_DATE_TOKEN_REGEX = /\b(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])(?:\/(\d{4}))?\b/g;
const VALUE_EXPECTING_KEYWORDS = new Set(["-start", "-end", "-color", "timer", "pomo", "vouch", ".v", "repeat"]);
const COLOR_COMPLETION_TOKENS = [
    ...GOOGLE_EVENT_COLOR_OPTIONS.map((option) => option.aliasToken),
    ...GOOGLE_EVENT_COLOR_OPTIONS.map((option) => option.nativeToken),
    "-lightgreen",
    "-light-green",
    "-lightblue",
    "-light-blue",
];
const EVENT_ONLY_COMPLETION_TOKENS = new Set<string>([
    "-start",
    "-end",
    "-color",
    ...COLOR_COMPLETION_TOKENS,
]);
const PARSER_KEYWORD_COMPLETION_TOKENS = Array.from(new Set([
    "-event",
    "-bound",
    "-start",
    "-end",
    "-color",
    "-proof",
    "remind@",
    "timer",
    "pomo",
    "vouch",
    ".v",
    "repeat",
    "tmrw",
    "tomorrow",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    ...COLOR_COMPLETION_TOKENS,
]));
const REPEAT_TYPE_OPTIONS = ["daily", "weekly", "monthly", "yearly"];

export interface TaskTitleHighlightSegment {
    text: string;
    className: string;
    style?: CSSProperties;
}

export interface ParserKeywordCompletion {
    fragmentStart: number;
    fragment: string;
    suggestion: string;
    suffix: string;
    insertText: string;
}

export interface AppliedParserKeywordCompletion {
    nextTitle: string;
    nextCaretIndex: number;
}

export interface TaskTitleOverlayModel {
    titleHighlightSegments: TaskTitleHighlightSegment[];
    inlineKeywordCompletion: ParserKeywordCompletion | null;
    showTitleOverlay: boolean;
}

export function buildTaskTitleHighlightSegments(text: string): TaskTitleHighlightSegment[] {
    if (!text) return [{ text: "", className: "text-white" }];

    const classNames = Array<string>(text.length).fill("text-white");
    const inlineStyles = Array<CSSProperties | undefined>(text.length).fill(undefined);
    const applyKeywordRange = (start: number, end: number) => {
        const clampedStart = Math.max(0, start);
        const clampedEnd = Math.min(text.length, end);
        for (let index = clampedStart; index < clampedEnd; index += 1) {
            if (classNames[index] === "text-white") {
                classNames[index] = "text-orange-400";
            }
        }
    };
    const applyColorRange = (start: number, end: number, colorHex: string) => {
        const clampedStart = Math.max(0, start);
        const clampedEnd = Math.min(text.length, end);
        for (let index = clampedStart; index < clampedEnd; index += 1) {
            classNames[index] = "";
            inlineStyles[index] = { color: colorHex };
        }
    };

    const isEventTask = EVENT_TOKEN_REGEX.test(text);

    for (const match of text.matchAll(HIGHLIGHT_EVENT_TOKEN_REGEX)) {
        if (!match[2]) continue;
        const start = (match.index ?? 0) + (match[1]?.length ?? 0);
        applyKeywordRange(start, start + match[2].length);
    }

    if (!isEventTask) {
        for (const match of text.matchAll(HIGHLIGHT_TIME_TOKEN_REGEX)) {
            if (!match[2] || !match[3]) continue;
            const rawToken = match[2];
            const parsed = parseTaskInputTimeToken(match[3], true);
            if (!parsed) continue;
            const start = (match.index ?? 0) + (match[1]?.length ?? 0);
            applyKeywordRange(start, start + rawToken.length);
        }
    }

    if (isEventTask) {
        for (const match of text.matchAll(HIGHLIGHT_EVENT_START_TOKEN_REGEX)) {
            if (!match[2] || !match[3]) continue;
            const parsed = parseTaskInputTimeToken(match[3], true);
            if (!parsed) continue;
            const start = (match.index ?? 0) + (match[1]?.length ?? 0);
            applyKeywordRange(start, start + match[2].length);
        }

        for (const match of text.matchAll(HIGHLIGHT_EVENT_END_TOKEN_REGEX)) {
            if (!match[2] || !match[3]) continue;
            const parsed = parseTaskInputTimeToken(match[3], true);
            if (!parsed) continue;
            const start = (match.index ?? 0) + (match[1]?.length ?? 0);
            applyKeywordRange(start, start + match[2].length);
        }

        for (const match of text.matchAll(HIGHLIGHT_EVENT_COLOR_HELPER_TOKEN_REGEX)) {
            if (!match[2]) continue;
            const start = (match.index ?? 0) + (match[1]?.length ?? 0);
            applyKeywordRange(start, start + match[2].length);
        }
    }

    for (const match of text.matchAll(HIGHLIGHT_PROOF_TOKEN_REGEX)) {
        if (!match[2]) continue;
        const start = (match.index ?? 0) + (match[1]?.length ?? 0);
        applyKeywordRange(start, start + match[2].length);
    }

    for (const match of text.matchAll(HIGHLIGHT_TIMER_TOKEN_REGEX)) {
        if (!match[0] || !match[2]) continue;
        const parsed = Number.parseInt(match[2], 10);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10000) continue;
        const start = match.index ?? 0;
        applyKeywordRange(start, start + match[0].length);
    }

    for (const match of text.matchAll(HIGHLIGHT_POMO_TOKEN_REGEX)) {
        if (!match[0] || !match[2]) continue;
        const parsed = Number.parseInt(match[2], 10);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_POMO_DURATION_MINUTES) continue;
        const start = match.index ?? 0;
        applyKeywordRange(start, start + match[0].length);
    }

    for (const match of text.matchAll(HIGHLIGHT_REMIND_TOKEN_REGEX)) {
        if (!match[2] || !match[3]) continue;
        const parsed = parseTaskInputTimeToken(match[3], true);
        if (!parsed) continue;
        const start = (match.index ?? 0) + (match[1]?.length ?? 0);
        applyKeywordRange(start, start + match[2].length);
    }

    for (const match of text.matchAll(new RegExp(HIGHLIGHT_REPEAT_TOKEN_REGEX.source, "gi"))) {
        if (!match[0]) continue;
        const start = match.index ?? 0;
        applyKeywordRange(start, start + match[0].length);
    }

    for (const match of text.matchAll(HIGHLIGHT_TOMORROW_TOKEN_REGEX)) {
        if (!match[0]) continue;
        const start = match.index ?? 0;
        applyKeywordRange(start, start + match[0].length);
    }

    for (const match of text.matchAll(new RegExp(WEEKDAY_TOKEN_REGEX.source, "gi"))) {
        if (!match[0]) continue;
        const start = match.index ?? 0;
        applyKeywordRange(start, start + match[0].length);
    }

    for (const match of text.matchAll(HIGHLIGHT_VOUCH_TOKEN_REGEX)) {
        if (!match[2] || !match[3]) continue;
        const start = (match.index ?? 0) + (match[1]?.length ?? 0);
        applyKeywordRange(start, start + `${match[2]} ${match[3]}`.length);
    }

    for (const match of text.matchAll(HIGHLIGHT_ORDINAL_DATE_TOKEN_REGEX)) {
        if (!match[0] || !match[1]) continue;
        const parsedDay = Number.parseInt(match[1], 10);
        if (!Number.isInteger(parsedDay) || parsedDay < 1 || parsedDay > 31) continue;
        const start = match.index ?? 0;
        applyKeywordRange(start, start + match[0].length);
    }

    for (const match of text.matchAll(HIGHLIGHT_SLASH_DATE_TOKEN_REGEX)) {
        if (!match[0]) continue;
        const start = match.index ?? 0;
        applyKeywordRange(start, start + match[0].length);
    }

    if (isEventTask) {
        for (const colorMatch of extractEventColorMatches(text)) {
            const colorOption = GOOGLE_EVENT_COLOR_OPTIONS.find((option) => option.colorId === colorMatch.colorId);
            if (!colorOption) continue;
            applyColorRange(colorMatch.start, colorMatch.end, colorOption.swatchHex);
        }
    }

    const segments: TaskTitleHighlightSegment[] = [];
    let segmentStart = 0;
    for (let index = 1; index < text.length; index += 1) {
        const classChanged = classNames[index] !== classNames[index - 1];
        const styleChanged = inlineStyles[index]?.color !== inlineStyles[index - 1]?.color;
        if (!classChanged && !styleChanged) continue;
        segments.push({
            text: text.slice(segmentStart, index),
            className: classNames[index - 1],
            style: inlineStyles[index - 1],
        });
        segmentStart = index;
    }
    segments.push({
        text: text.slice(segmentStart),
        className: classNames[text.length - 1],
        style: inlineStyles[text.length - 1],
    });

    return segments;
}

export function getParserKeywordCompletion(
    text: string,
    caretIndex: number,
    friends: Profile[]
): ParserKeywordCompletion | null {
    if (caretIndex !== text.length) return null;

    const leading = text.slice(0, caretIndex);
    const isEventTask = EVENT_TOKEN_REGEX.test(text);
    const allowedCompletionTokens = isEventTask
        ? PARSER_KEYWORD_COMPLETION_TOKENS
        : PARSER_KEYWORD_COMPLETION_TOKENS.filter((token) => !EVENT_ONLY_COMPLETION_TOKENS.has(token));

    const repeatMatch = leading.match(/(?:^|\s)repeat\s+([^\s]*)$/i);
    if (repeatMatch) {
        const typeFragment = repeatMatch[1];
        const normalized = typeFragment.toLowerCase();
        const suggestion = REPEAT_TYPE_OPTIONS.find((t) => t.startsWith(normalized) && t !== normalized);
        if (suggestion) {
            const suffix = suggestion.slice(typeFragment.length);
            if (suffix) {
                return {
                    fragmentStart: caretIndex - typeFragment.length,
                    fragment: typeFragment,
                    suggestion,
                    suffix,
                    insertText: suggestion,
                };
            }
        }
        return null;
    }

    const voucherMatch = leading.match(/(?:^|\s)(?:vouch|\.v)\s+([^\s]+)$/i);
    if (voucherMatch) {
        const nameFragment = voucherMatch[1];
        const normalized = nameFragment.toLowerCase();
        if (!["me", "self", "myself"].includes(normalized)) {
            const match = friends.find(
                (f) => f.username.toLowerCase().startsWith(normalized) && f.username.toLowerCase() !== normalized
            );
            if (match) {
                const suffix = match.username.slice(nameFragment.length);
                if (suffix) {
                    return {
                        fragmentStart: caretIndex - nameFragment.length,
                        fragment: nameFragment,
                        suggestion: match.username,
                        suffix,
                        insertText: match.username,
                    };
                }
            }
        }
        return null;
    }

    const tokenMatch = leading.match(/(^|\s)([^\s]+)$/);
    if (!tokenMatch) return null;

    const fragment = tokenMatch[2];
    if (!fragment || fragment.length < 2) return null;
    if (/[0-9:\/]/.test(fragment)) return null;

    const normalized = fragment.toLowerCase();
    if (allowedCompletionTokens.includes(normalized)) return null;

    const suggestion = allowedCompletionTokens.find((keyword) => keyword.startsWith(normalized));
    if (!suggestion) return null;

    const insertText = VALUE_EXPECTING_KEYWORDS.has(suggestion)
        ? `${suggestion} `
        : suggestion;
    const suffix = insertText.slice(fragment.length);
    if (!suffix) return null;

    return {
        fragmentStart: caretIndex - fragment.length,
        fragment,
        suggestion,
        suffix,
        insertText,
    };
}

export function applyParserKeywordCompletion(
    text: string,
    completion: ParserKeywordCompletion
): AppliedParserKeywordCompletion {
    const fragmentEnd = completion.fragmentStart + completion.fragment.length;
    const nextTitle =
        `${text.slice(0, completion.fragmentStart)}${completion.insertText}${text.slice(fragmentEnd)}`;

    return {
        nextTitle,
        nextCaretIndex: completion.fragmentStart + completion.insertText.length,
    };
}

export function buildTaskTitleOverlayModel(
    title: string,
    titleCaretIndex: number,
    isTitleFocused: boolean,
    isColorPickerVisible: boolean,
    friends: Profile[]
): TaskTitleOverlayModel {
    const titleHighlightSegments = buildTaskTitleHighlightSegments(title);
    const inlineKeywordCompletion =
        !isTitleFocused || isColorPickerVisible
            ? null
            : getParserKeywordCompletion(title, titleCaretIndex, friends);
    const showTitleOverlay = isTitleFocused || shouldRenderTaskTitleOverlay(
        title,
        titleHighlightSegments,
        inlineKeywordCompletion?.suffix
    );

    return {
        titleHighlightSegments,
        inlineKeywordCompletion,
        showTitleOverlay,
    };
}

// ---------------------------------------------------------------------------
// Date helpers (extracted from TaskInput.tsx)
// ---------------------------------------------------------------------------

export const TOMORROW_KEYWORD_REGEX = /\b(?:tmr|tmrw|tomorrow)\b/i;
export const ORDINAL_DATE_TOKEN_REGEX = /\b([12]?\d|3[01])(st|nd|rd|th)\b/gi;
export const SLASH_DATE_TOKEN_REGEX = /\b(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])(?:\/(\d{4}))?\b/g;

export type ParsedDateToken =
    | { kind: "ordinal"; day: number; index: number }
    | { kind: "slash"; day: number; month: number; year: number | null; index: number };

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
    const candidate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
    return (
        candidate.getUTCFullYear() === year &&
        candidate.getUTCMonth() + 1 === month &&
        candidate.getUTCDate() === day
    );
}

export function getDefaultDeadline(now: Date = new Date()): Date {
    const deadline = new Date(now);
    deadline.setHours(23, 0, 0, 0);
    if (deadline.getTime() <= now.getTime()) {
        deadline.setDate(deadline.getDate() + 1);
    }
    return deadline;
}

export function parseDateTokens(text: string): ParsedDateToken[] {
    const tokens: ParsedDateToken[] = [];

    const ordinalRegex = new RegExp(ORDINAL_DATE_TOKEN_REGEX.source, "gi");
    let ordinalMatch: RegExpExecArray | null;
    while ((ordinalMatch = ordinalRegex.exec(text)) !== null) {
        const parsedDay = Number.parseInt(ordinalMatch[1], 10);
        if (parsedDay >= 1 && parsedDay <= 31) {
            tokens.push({
                kind: "ordinal",
                day: parsedDay,
                index: ordinalMatch.index,
            });
        }
    }

    const slashRegex = new RegExp(SLASH_DATE_TOKEN_REGEX.source, "g");
    let slashMatch: RegExpExecArray | null;
    while ((slashMatch = slashRegex.exec(text)) !== null) {
        const parsedDay = Number.parseInt(slashMatch[1], 10);
        const parsedMonth = Number.parseInt(slashMatch[2], 10);
        const parsedYear = slashMatch[3] ? Number.parseInt(slashMatch[3], 10) : null;
        tokens.push({
            kind: "slash",
            day: parsedDay,
            month: parsedMonth,
            year: parsedYear,
            index: slashMatch.index,
        });
    }

    return tokens.sort((a, b) => a.index - b.index);
}

export const REPEAT_TOKEN_REGEX = /\brepeat\s+(daily|weekly|monthly|yearly)\b/i;
const REPEAT_TOKEN_GLOBAL_REGEX = /\brepeat\s+(?:daily|weekly|monthly|yearly)\b/gi;

export function parseRepeatTokenFromTitle(text: string): "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | null {
    if (!text) return null;
    const match = text.match(REPEAT_TOKEN_REGEX);
    if (!match) return null;
    return match[1].toUpperCase() as "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
}

export function stripRepeatTokens(text: string): string {
    if (!text) return "";
    return text
        .replace(REPEAT_TOKEN_GLOBAL_REGEX, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function parseTimerMinutesToken(text: string): number | null {
    const match = text.match(/\btimer\s+(\d+)\b/i);
    if (!match) return null;

    const parsed = Number.parseInt(match[1], 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10000) return null;
    return parsed;
}

export const PROOF_REQUIRED_TOKEN_REGEX = /(^|\s)-proof(?=\s|$)/i;
const PROOF_REQUIRED_TOKEN_GLOBAL_REGEX = /(^|\s)-proof(?=\s|$)/gi;

export function parseProofRequiredFromTitle(text: string): boolean {
    if (!text) return false;
    return PROOF_REQUIRED_TOKEN_REGEX.test(text);
}

export function stripProofRequiredTokens(text: string): string {
    if (!text) return "";
    return text
        .replace(PROOF_REQUIRED_TOKEN_GLOBAL_REGEX, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function parseReminderTimesFromTitle(text: string): Array<{ hours: number; minutes: number }> {
    const regex = /(?:^|\s)remind@(\d{1,2}:\d{2}(?:\s*(?:am|pm))?|\d{1,4}(?:\s*(?:am|pm))?|\d{1,2}(?:\s*(?:am|pm))?)\b/gi;
    const results: Array<{ hours: number; minutes: number }> = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
        const parsed = parseTaskInputTimeToken(match[1], true);
        if (!parsed) continue;
        results.push(parsed);
    }

    return results;
}

export function resolveEventAnchorDate(
    text: string,
    now: Date = new Date()
): { anchorDate: Date; error: string | null } {
    const parsedDateTokens = parseDateTokens(text);
    const parsedWeekdayTokens = extractWeekdayDateTokens(text);
    if (parsedDateTokens.length > 1 || parsedWeekdayTokens.length > 1) {
        return {
            anchorDate: getDefaultDeadline(now),
            error: "Use only one date token (for example: monday, 28th or 05/03).",
        };
    }

    const hasTomorrowKeyword = TOMORROW_KEYWORD_REGEX.test(text);

    if (parsedDateTokens.length === 1) {
        const dateToken = parsedDateTokens[0];
        const year = dateToken.kind === "slash" ? (dateToken.year ?? now.getFullYear()) : now.getFullYear();
        const month = dateToken.kind === "slash" ? dateToken.month : now.getMonth() + 1;
        const day = dateToken.day;

        if (!isValidCalendarDate(year, month, day)) {
            return {
                anchorDate: getDefaultDeadline(now),
                error: "Date is invalid. Use 28th, 05/03, or 05/03/2026.",
            };
        }

        return {
            anchorDate: new Date(year, month - 1, day, 12, 0, 0, 0),
            error: null,
        };
    }

    if (parsedWeekdayTokens.length === 1) {
        const anchorDate = resolveUpcomingWeekdayDate(parsedWeekdayTokens[0].weekday, now);
        anchorDate.setHours(12, 0, 0, 0);
        return { anchorDate, error: null };
    }

    if (hasTomorrowKeyword) {
        const anchorDate = new Date(now);
        anchorDate.setDate(anchorDate.getDate() + 1);
        anchorDate.setHours(12, 0, 0, 0);
        return { anchorDate, error: null };
    }

    return {
        anchorDate: getDefaultDeadline(now),
        error: null,
    };
}
