function padTwo(value: number): string {
    return String(value).padStart(2, "0");
}

function parseTimestamp(value: string | Date): Date | null {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

export function formatDateOnlyDDMMYYYY(value: string): string {
    const parts = value.split("-");
    if (parts.length === 3) {
        const [year, month, day] = parts;
        if (year && month && day) {
            return `${day}/${month}/${year}`;
        }
    }

    const date = parseTimestamp(value);
    if (!date) return value;
    const day = padTwo(date.getDate());
    const month = padTwo(date.getMonth() + 1);
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

export function formatDateTimeDDMMYYYY(value: string | Date): string {
    const date = parseTimestamp(value);
    if (!date) {
        return typeof value === "string" ? value : "";
    }

    const day = padTwo(date.getDate());
    const month = padTwo(date.getMonth() + 1);
    const year = date.getFullYear();
    const hours = padTwo(date.getHours());
    const minutes = padTwo(date.getMinutes());
    return `${day}/${month}/${year} ${hours}:${minutes}`;
}
