import type { RecurrenceRuleConfig } from "@/lib/types";

export type DateParts = { year: number; month: number; day: number };

export function toDateStr(parts: DateParts): string {
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function addLocalDays(parts: DateParts, days: number): DateParts {
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function ymdToUtcMidnightMs(ymd: string): number {
    const [y, m, d] = ymd.split("-").map(Number);
    return Date.UTC(y, m - 1, d, 0, 0, 0, 0);
}

function localDayOfWeek(ymd: string): number {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function monthDiffFrom(fromYmd: string, toYmd: string): number {
    const [fy, fm] = fromYmd.split("-").map(Number);
    const [ty, tm] = toYmd.split("-").map(Number);
    return (ty - fy) * 12 + (tm - fm);
}

function yearDiffFrom(fromYmd: string, toYmd: string): number {
    const [fy] = fromYmd.split("-").map(Number);
    const [ty] = toYmd.split("-").map(Number);
    return ty - fy;
}

export function buildTimeZoneContext(timezone: string) {
    const localDateFormatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    const localDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });

    const getLocalDateParts = (value: Date): DateParts => {
        const parts = localDateFormatter.formatToParts(value);
        const map: Record<string, string> = {};
        for (const part of parts) {
            if (part.type !== "literal") map[part.type] = part.value;
        }
        return {
            year: Number(map.year),
            month: Number(map.month),
            day: Number(map.day),
        };
    };

    const resolveUtcForLocalDateTime = (
        dateParts: DateParts,
        hour: number,
        minute: number
    ): string => {
        const targetWall = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, hour, minute, 0, 0);
        let guess = targetWall;
        for (let i = 0; i < 6; i++) {
            const rendered = localDateTimeFormatter.formatToParts(new Date(guess));
            const map: Record<string, string> = {};
            for (const part of rendered) {
                if (part.type !== "literal") map[part.type] = part.value;
            }
            const wallAtGuess = Date.UTC(
                Number(map.year),
                Number(map.month) - 1,
                Number(map.day),
                Number(map.hour),
                Number(map.minute),
                Number(map.second),
                0
            );
            const diff = wallAtGuess - targetWall;
            if (Math.abs(diff) < 1000) break;
            guess -= diff;
        }
        return new Date(guess).toISOString();
    };

    return { getLocalDateParts, resolveUtcForLocalDateTime };
}

export function shouldRunForLocalDate(
    frequency: RecurrenceRuleConfig["frequency"],
    interval: number,
    daysOfWeek: number[] | null | undefined,
    createdLocalDateStr: string,
    currentLocalDateStr: string
): boolean {
    const anchorDayMs = ymdToUtcMidnightMs(createdLocalDateStr);
    const currentDayMs = ymdToUtcMidnightMs(currentLocalDateStr);
    const daysFromAnchor = Math.floor((currentDayMs - anchorDayMs) / (24 * 60 * 60 * 1000));
    if (daysFromAnchor < 0) return false;

    switch (frequency) {
        case "DAILY":
            return daysFromAnchor % interval === 0;
        case "WEEKLY": {
            const allowedDays = Array.isArray(daysOfWeek) ? daysOfWeek : [];
            const weekday = localDayOfWeek(currentLocalDateStr);
            if (!allowedDays.includes(weekday)) return false;
            const anchorWeekStart = anchorDayMs - localDayOfWeek(createdLocalDateStr) * 24 * 60 * 60 * 1000;
            const currentWeekStart = currentDayMs - weekday * 24 * 60 * 60 * 1000;
            const weeksFromAnchor = Math.floor((currentWeekStart - anchorWeekStart) / (7 * 24 * 60 * 60 * 1000));
            return weeksFromAnchor >= 0 && (weeksFromAnchor % interval === 0);
        }
        case "WEEKDAYS": {
            const day = localDayOfWeek(currentLocalDateStr);
            return day >= 1 && day <= 5;
        }
        case "MONTHLY": {
            const [, , currentDay] = currentLocalDateStr.split("-").map(Number);
            const [, , anchorDay] = createdLocalDateStr.split("-").map(Number);
            const months = monthDiffFrom(createdLocalDateStr, currentLocalDateStr);
            return currentDay === anchorDay && months >= 0 && months % interval === 0;
        }
        case "YEARLY": {
            const [, currentMonth, currentDay] = currentLocalDateStr.split("-").map(Number);
            const [, anchorMonth, anchorDay] = createdLocalDateStr.split("-").map(Number);
            const years = yearDiffFrom(createdLocalDateStr, currentLocalDateStr);
            return (
                currentMonth === anchorMonth &&
                currentDay === anchorDay &&
                years >= 0 &&
                years % interval === 0
            );
        }
        case "CUSTOM":
            return daysFromAnchor % interval === 0;
        default:
            return false;
    }
}

export function recurrenceAnchorLocalDate(
    rule: { last_generated_date: string | null; created_at: string },
    getLocalDateParts: (date: Date) => DateParts
): string {
    return rule.last_generated_date || toDateStr(getLocalDateParts(new Date(rule.created_at)));
}

function parseDateStr(value: string): DateParts {
    const [year, month, day] = value.split("-").map(Number);
    return { year, month, day };
}

export interface RecurrenceScheduleRule {
    id: string;
    title: string;
    rule_config: RecurrenceRuleConfig;
    timezone: string | null;
    last_generated_date: string | null;
    paused_at?: string | null;
    created_at: string;
    google_sync_for_rule?: boolean | null;
    time_bound_for_rule?: boolean | null;
    window_start_offset_minutes?: number | null;
    google_event_duration_minutes?: number | null;
}

export interface RecurrenceOccurrence {
    ruleId: string;
    title: string;
    localDate: string;
    deadlineIso: string;
    spanStartIso: string | null;
    isEvent: boolean;
    isStrict: boolean;
}

export function computeOccurrenceTimes(
    rule: Pick<RecurrenceScheduleRule, "rule_config" | "timezone" | "window_start_offset_minutes" | "google_event_duration_minutes">,
    localDateStr: string
): { deadlineIso: string; windowStartIso: string | null } {
    const { resolveUtcForLocalDateTime } = buildTimeZoneContext(rule.timezone || "UTC");
    const [hours, minutes] = rule.rule_config.time_of_day.split(":").map(Number);
    const localParts = parseDateStr(localDateStr);
    const deadlineDateParts = hours === 0 && minutes === 0 ? addLocalDays(localParts, 1) : localParts;
    const deadlineIso = resolveUtcForLocalDateTime(deadlineDateParts, hours, minutes);
    const windowStartOffsetMinutes = Number(rule.window_start_offset_minutes ?? rule.google_event_duration_minutes);
    const windowStartIso = Number.isFinite(windowStartOffsetMinutes) && windowStartOffsetMinutes > 0
        ? new Date(new Date(deadlineIso).getTime() - windowStartOffsetMinutes * 60 * 1000).toISOString()
        : null;
    return { deadlineIso, windowStartIso };
}

const MAX_GHOST_SCAN_DAYS = 400;

export function listUpcomingOccurrences(
    rule: RecurrenceScheduleRule,
    rangeStartMs: number,
    rangeEndMs: number,
    now: Date = new Date()
): RecurrenceOccurrence[] {
    if (rule.paused_at) return [];
    if (!rule.rule_config || typeof rule.rule_config.time_of_day !== "string") return [];
    if (!Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndMs) || rangeEndMs <= rangeStartMs) return [];

    const { frequency, interval, days_of_week } = rule.rule_config;
    const normalizedInterval = Number.isFinite(interval) && interval > 0 ? Math.floor(interval) : 1;
    const { getLocalDateParts } = buildTimeZoneContext(rule.timezone || "UTC");
    const anchorLocalDateStr = recurrenceAnchorLocalDate(rule, getLocalDateParts);
    const todayLocal = toDateStr(getLocalDateParts(now));
    const rangeFirstLocal = toDateStr(addLocalDays(getLocalDateParts(new Date(rangeStartMs)), -1));
    const rangeLastLocal = toDateStr(getLocalDateParts(new Date(rangeEndMs)));

    let cursor = parseDateStr(rangeFirstLocal > todayLocal ? rangeFirstLocal : todayLocal);
    const isEvent = Boolean(rule.google_sync_for_rule) || Boolean(rule.time_bound_for_rule);
    const isStrict = Boolean(rule.time_bound_for_rule);
    const occurrences: RecurrenceOccurrence[] = [];

    for (let i = 0; i < MAX_GHOST_SCAN_DAYS; i++) {
        const localDate = toDateStr(cursor);
        if (localDate > rangeLastLocal) break;
        cursor = addLocalDays(cursor, 1);

        if (rule.last_generated_date && rule.last_generated_date >= localDate) continue;
        if (!shouldRunForLocalDate(frequency, normalizedInterval, days_of_week, anchorLocalDateStr, localDate)) continue;

        const { deadlineIso, windowStartIso } = computeOccurrenceTimes(rule, localDate);
        const deadlineMs = new Date(deadlineIso).getTime();
        if (deadlineMs < rangeStartMs || deadlineMs >= rangeEndMs) continue;

        occurrences.push({
            ruleId: rule.id,
            title: rule.title,
            localDate,
            deadlineIso,
            spanStartIso: isEvent ? windowStartIso : null,
            isEvent,
            isStrict,
        });
    }

    return occurrences;
}
