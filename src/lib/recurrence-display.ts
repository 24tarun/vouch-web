import type { RecurrenceRule } from "@/lib/types";

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const FALLBACK_SUMMARY = "Repeats on a custom schedule";

function toOrdinalDay(day: number): string {
    const mod100 = day % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${day}th`;

    const mod10 = day % 10;
    if (mod10 === 1) return `${day}st`;
    if (mod10 === 2) return `${day}nd`;
    if (mod10 === 3) return `${day}rd`;
    return `${day}th`;
}

function joinWithAnd(parts: string[]): string {
    if (parts.length === 0) return "";
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
    return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function getWeekdayName(index: number, locale?: string): string | null {
    if (!Number.isInteger(index) || index < 0 || index > 6) return null;
    const sunday = new Date(Date.UTC(2024, 0, 7)); // Known Sunday in UTC.
    const date = new Date(sunday);
    date.setUTCDate(sunday.getUTCDate() + index);
    return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(date);
}

function getLocalTimeLabel(deadline: Date, locale?: string): string {
    return new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(deadline);
}

function normalizeDaysOfWeek(rawDays: unknown, fallbackDay?: number): number[] {
    const unique = new Set<number>();
    if (Array.isArray(rawDays)) {
        for (const day of rawDays) {
            const parsed = Number(day);
            if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 6) {
                unique.add(parsed);
            }
        }
    }

    const hasValidFallbackDay =
        typeof fallbackDay === "number" &&
        Number.isInteger(fallbackDay) &&
        fallbackDay >= 0 &&
        fallbackDay <= 6;
    if (unique.size === 0 && hasValidFallbackDay) {
        unique.add(fallbackDay);
    }

    return WEEKDAY_ORDER.filter((day) => unique.has(day));
}

export function formatRecurrenceSummary(
    rule: RecurrenceRule,
    taskDeadlineIso: string,
    locale?: string
): string {
    const config = rule?.rule_config;
    if (!config || !config.frequency) {
        return FALLBACK_SUMMARY;
    }

    const deadline = new Date(taskDeadlineIso);
    const hasValidDeadline = !Number.isNaN(deadline.getTime());
    const atTime = hasValidDeadline ? ` at ${getLocalTimeLabel(deadline, locale)}` : "";
    const localDayOfMonth = hasValidDeadline ? deadline.getDate() : null;
    const localWeekday = hasValidDeadline ? deadline.getDay() : undefined;
    const frequency = String(config.frequency).toUpperCase();

    if (frequency === "DAILY") {
        return `Repeats daily${atTime}`;
    }

    if (frequency === "WEEKLY") {
        const days = normalizeDaysOfWeek(config.days_of_week, localWeekday);
        const names = days.map((day) => getWeekdayName(day, locale)).filter((name): name is string => Boolean(name));
        if (names.length === 1) return `Repeats weekly on ${names[0]}${atTime}`;
        if (names.length > 1) return `Repeats every ${joinWithAnd(names)}${atTime}`;
        return FALLBACK_SUMMARY;
    }

    if (frequency === "MONTHLY") {
        if (localDayOfMonth != null) {
            return `Repeats monthly on ${toOrdinalDay(localDayOfMonth)}${atTime}`;
        }
        return `Repeats monthly${atTime}`;
    }

    if (frequency === "CUSTOM") {
        const days = normalizeDaysOfWeek(config.days_of_week, localWeekday);
        const names = days.map((day) => getWeekdayName(day, locale)).filter((name): name is string => Boolean(name));
        if (names.length > 0) return `Repeats every ${joinWithAnd(names)}${atTime}`;
        return FALLBACK_SUMMARY;
    }

    if (frequency === "WEEKDAYS") {
        return `Repeats every weekday${atTime}`;
    }

    return FALLBACK_SUMMARY;
}
