export const EVENT_COLORS = [
    { label: "Lavender",  hex: "#7986CB" },
    { label: "Sage",      hex: "#33B679" },
    { label: "Grape",     hex: "#8E24AA" },
    { label: "Flamingo",  hex: "#E67C73" },
    { label: "Banana",    hex: "#F6BF26" },
    { label: "Tangerine", hex: "#F4511E" },
    { label: "Peacock",   hex: "#039BE5" },
    { label: "Graphite",  hex: "#616161" },
    { label: "Blueberry", hex: "#3F51B5" },
    { label: "Basil",     hex: "#0B8043" },
    { label: "Tomato",    hex: "#D50000" },
] as const;

export const REMINDER_PRESETS = [
    { label: "5 min",   minutes: 5 },
    { label: "30 min",  minutes: 30 },
    { label: "1 hour",  minutes: 60 },
    { label: "3 hours", minutes: 180 },
] as const;

export const DEFAULT_REMINDER_MINUTES: ReadonlySet<number> = new Set([5, 60]);

export const REPEAT_OPTIONS = ["None", "Daily", "Weekdays", "Weekly", "Monthly"] as const;

export function pad(n: number) {
    return String(n).padStart(2, "0");
}

export function toLocalDT(d: Date) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function defaultDeadline() {
    const d = new Date();
    d.setHours(23, 59, 0, 0);
    return toLocalDT(d);
}

export function defaultStart() {
    const d = new Date();
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    return toLocalDT(d);
}

export function defaultEnd() {
    const d = new Date();
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15 + 60, 0, 0);
    return toLocalDT(d);
}
