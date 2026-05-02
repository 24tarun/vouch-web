export function formatTimeUntilDeadline(deadline: Date, now: Date = new Date()): string {
    const diffMs = deadline.getTime() - now.getTime();
    if (diffMs <= 0) {
        return "Deadline passed";
    }
    const totalMinutes = Math.max(1, Math.floor(diffMs / (1000 * 60)));
    const days = Math.floor(totalMinutes / (24 * 60));
    const remainingAfterDays = totalMinutes % (24 * 60);
    const hours = Math.floor(remainingAfterDays / 60);
    const minutes = remainingAfterDays % 60;
    const parts: string[] = [];

    if (days > 0) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
    if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes} ${minutes === 1 ? "min" : "mins"}`);

    return `${parts.join(" ")} until deadline`;
}

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_SHORT: Record<number, string> = {
    1: "M",
    2: "T",
    3: "W",
    4: "T",
    5: "F",
    6: "S",
    0: "S",
};

export function getSelectedWeekday(selectedDate: Date | null): number {
    return selectedDate?.getDay() ?? new Date().getDay();
}

export function formatCustomDaysLabel(days: number[]): string {
    const ordered = WEEKDAY_ORDER.filter((day) => days.includes(day));
    return ordered.map((day) => WEEKDAY_SHORT[day]).join(" ");
}

export function formatDeadlineLabel(date: Date | null, hasMounted: boolean): string {
    if (!hasMounted || !date) return "Set date";
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = date.getFullYear();
    const time = date.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
    return `${dd}/${mm}/${yyyy} at ${time}`;
}

export function formatDeadlineTitle(date: Date | null, hasMounted: boolean): string {
    if (!hasMounted || !date) return "Set Date";
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = date.getFullYear();
    const time = date.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
    return `${dd}/${mm}/${yyyy} at ${time}`;
}

export function formatReminderLabel(date: Date): string {
    return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export function buildReminderDateOnDeadlineDay(deadlineDate: Date, hours: number, minutes: number): Date {
    const reminderDate = new Date(deadlineDate);
    reminderDate.setHours(hours, minutes, 0, 0);
    return reminderDate;
}
