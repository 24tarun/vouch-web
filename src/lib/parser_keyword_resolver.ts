import { resolveEventSchedule } from "@/lib/task-title-event-time";
import {
    EVENT_TOKEN_REGEX,
    extractWeekdayDateTokens,
    getDefaultDeadline,
    isValidCalendarDate,
    parseDateTokens,
    parseTaskInputTimeToken,
    parseTimerMinutesToken,
    resolveEventAnchorDate,
    resolveUpcomingWeekdayDate,
    stripRepeatTokens,
    TOMORROW_KEYWORD_REGEX,
    WEEKDAY_TOKEN_REGEX,
} from "@/lib/task-title-parser";
import { stripEventColorTokens } from "@/lib/task-title-event-color";

const TIME_TOKEN_REGEX = /(?:^|\s)@(\d{1,2}:\d{2}(?:\s*(?:am|pm))?|\d{1,4}(?:\s*(?:am|pm))?|\d{1,2}(?:\s*(?:am|pm))?)\b/i;

export interface ResolveTaskDeadlineResult {
    deadline: Date;
    error: string | null;
}

export function hasParserDrivenDeadlineHint(text: string): boolean {
    if (!text) return false;
    if (EVENT_TOKEN_REGEX.test(text)) return true;
    if (parseTimerMinutesToken(text) !== null) return true;
    if (parseDateTokens(text).length > 0) return true;
    if (extractWeekdayDateTokens(text).length > 0) return true;
    if (TOMORROW_KEYWORD_REGEX.test(text)) return true;
    return TIME_TOKEN_REGEX.test(text);
}

export function resolveTaskDeadline(
    text: string,
    now: Date,
    defaultEventDurationMinutes: number
): ResolveTaskDeadlineResult {
    const defaultDeadline = getDefaultDeadline(now);
    const isEventTask = EVENT_TOKEN_REGEX.test(text);

    if (isEventTask) {
        const anchorResolution = resolveEventAnchorDate(text, now);
        if (anchorResolution.error) {
            return {
                deadline: defaultDeadline,
                error: anchorResolution.error,
            };
        }

        const eventResolution = resolveEventSchedule({
            rawTitle: text,
            anchorDate: anchorResolution.anchorDate,
            defaultDurationMinutes: defaultEventDurationMinutes,
            now,
        });

        if (eventResolution.error || !eventResolution.endDate) {
            return {
                deadline: defaultDeadline,
                error: eventResolution.error || "Event end time is invalid.",
            };
        }

        return {
            deadline: eventResolution.endDate,
            error: null,
        };
    }

    const timerMinutes = parseTimerMinutesToken(text);

    if (timerMinutes !== null) {
        const timerDeadline = new Date();
        timerDeadline.setTime(now.getTime() + timerMinutes * 60000);
        return { deadline: timerDeadline, error: null };
    }

    const parsedDateTokens = parseDateTokens(text);
    const parsedWeekdayTokens = extractWeekdayDateTokens(text);
    if (parsedDateTokens.length > 1 || parsedWeekdayTokens.length > 1) {
        return {
            deadline: defaultDeadline,
            error: "Use only one date token (for example: monday, 28th or 05/03).",
        };
    }

    const hasTomorrowKeyword = TOMORROW_KEYWORD_REGEX.test(text);
    const timeMatch = text.match(TIME_TOKEN_REGEX);
    const parsedTime = timeMatch ? parseTaskInputTimeToken(timeMatch[1], true) : null;

    if (timeMatch && !parsedTime) {
        return { deadline: defaultDeadline, error: "Deadline is invalid." };
    }

    if (parsedDateTokens.length === 1) {
        const dateToken = parsedDateTokens[0];
        const year = dateToken.kind === "slash" ? (dateToken.year ?? now.getFullYear()) : now.getFullYear();
        const month = dateToken.kind === "slash" ? dateToken.month : now.getMonth() + 1;
        const day = dateToken.day;

        if (!isValidCalendarDate(year, month, day)) {
            return { deadline: defaultDeadline, error: "Date is invalid. Use 28th, 05/03, or 05/03/2026." };
        }

        const deadline = new Date(
            year,
            month - 1,
            day,
            parsedTime?.hours ?? 23,
            parsedTime?.minutes ?? 0,
            0,
            0
        );

        if (deadline.getTime() <= now.getTime()) {
            return { deadline, error: "Deadline must be in the future." };
        }

        return { deadline, error: null };
    }

    if (parsedWeekdayTokens.length === 1) {
        const weekdayToken = parsedWeekdayTokens[0];
        const deadline = resolveUpcomingWeekdayDate(weekdayToken.weekday, now);
        deadline.setHours(parsedTime?.hours ?? 23, parsedTime?.minutes ?? 0, 0, 0);

        if (deadline.getTime() <= now.getTime()) {
            return { deadline, error: "Deadline must be in the future." };
        }

        return { deadline, error: null };
    }

    if (hasTomorrowKeyword) {
        const deadline = new Date(now);
        deadline.setDate(deadline.getDate() + 1);
        deadline.setHours(parsedTime?.hours ?? 23, parsedTime?.minutes ?? 0, 0, 0);

        return { deadline, error: null };
    }

    if (parsedTime) {
        const deadline = new Date(now);
        deadline.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);

        if (deadline.getTime() <= now.getTime()) {
            return { deadline, error: "Deadline must be in the future." };
        }

        return { deadline, error: null };
    }

    return { deadline: defaultDeadline, error: null };
}

export function stripMetadata(text: string): string {
    if (!text) return "";
    const withoutStandardTokens = text
        .replace(/(^|\s)@(?:\d{1,2}:\d{2}(?:\s*(?:am|pm))?|\d{1,4}(?:\s*(?:am|pm))?|\d{1,2}(?:\s*(?:am|pm))?)\b/gi, "$1")
        .replace(/(?:^|\s)-start\s*(?:\d{1,2}:\d{2}(?:\s*(?:am|pm))?|\d{1,4}(?:\s*(?:am|pm))?|\d{1,2}(?:\s*(?:am|pm))?)\b/gi, " ")
        .replace(/(?:^|\s)-end\s*(?:\d{1,2}:\d{2}(?:\s*(?:am|pm))?|\d{1,4}(?:\s*(?:am|pm))?|\d{1,2}(?:\s*(?:am|pm))?)\b/gi, " ")
        .replace(/\b([12]?\d|3[01])(?:st|nd|rd|th)\b/gi, "")
        .replace(/\b(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2])(?:\/\d{4})?\b/g, "")
        .replace(/(^|\s)remind@(?:\d{1,2}:\d{2}(?:\s*(?:am|pm))?|\d{1,4}(?:\s*(?:am|pm))?|\d{1,2}(?:\s*(?:am|pm))?)\b/gi, "$1")
        .replace(/\b(?:tmr|tmrw|tomorrow)\b/gi, "")
        .replace(new RegExp(WEEKDAY_TOKEN_REGEX.source, "gi"), "")
        .replace(/(?:\bvouch|\.v)\s+[^\s/]+/gi, "")
        .replace(/(?:^|\s)-proof(?=\s|$)/gi, " ")
        .replace(/\bpomo\s+\d+\b/gi, "")
        .replace(/\btimer\s+\d+\b/gi, "")
        .replace(/(^|\s)-bound(?=\s|$)/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

    return stripRepeatTokens(stripEventColorTokens(withoutStandardTokens));
}

export function parseTaskTitleAndSubtasks(text: string): { title: string, subtasks: string[] } {
    const cleaned = stripMetadata(text);
    const segments = cleaned.split("/").map((segment) => segment.trim());
    const title = segments[0] || "";
    const subtasks = segments.slice(1).filter(Boolean);

    return { title, subtasks };
}
