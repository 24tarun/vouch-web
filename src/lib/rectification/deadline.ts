import { fromZonedTime, toZonedTime } from "date-fns-tz";

const GUARANTEED_REVIEW_MS = 48 * 60 * 60 * 1000;

export function getRectificationAutoAt(submittedAt: Date, timeZone: string): Date {
    if (Number.isNaN(submittedAt.getTime())) throw new Error("Invalid rectification submission time");
    const local = toZonedTime(submittedAt, timeZone);
    const nextMonthYear = local.getMonth() === 11 ? local.getFullYear() + 1 : local.getFullYear();
    const nextMonth = (local.getMonth() + 1) % 12;
    const monthBoundaryLocal = `${nextMonthYear}-${String(nextMonth + 1).padStart(2, "0")}-01T00:00:00`;
    const monthBoundary = fromZonedTime(monthBoundaryLocal, timeZone);
    const guaranteedDeadline = new Date(submittedAt.getTime() + GUARANTEED_REVIEW_MS);
    return monthBoundary.getTime() > guaranteedDeadline.getTime() ? monthBoundary : guaranteedDeadline;
}
