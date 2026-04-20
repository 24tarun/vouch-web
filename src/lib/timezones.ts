const FALLBACK_TIMEZONES = [
    "UTC",
    "Africa/Cairo",
    "Africa/Johannesburg",
    "Africa/Lagos",
    "America/Anchorage",
    "America/Argentina/Buenos_Aires",
    "America/Chicago",
    "America/Denver",
    "America/Halifax",
    "America/Los_Angeles",
    "America/Mexico_City",
    "America/New_York",
    "America/Phoenix",
    "America/Sao_Paulo",
    "America/Toronto",
    "Asia/Bangkok",
    "Asia/Dhaka",
    "Asia/Dubai",
    "Asia/Hong_Kong",
    "Asia/Jakarta",
    "Asia/Karachi",
    "Asia/Kolkata",
    "Asia/Seoul",
    "Asia/Shanghai",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Australia/Adelaide",
    "Australia/Brisbane",
    "Australia/Melbourne",
    "Australia/Perth",
    "Australia/Sydney",
    "Europe/Amsterdam",
    "Europe/Athens",
    "Europe/Berlin",
    "Europe/Brussels",
    "Europe/Dublin",
    "Europe/Helsinki",
    "Europe/Istanbul",
    "Europe/Lisbon",
    "Europe/London",
    "Europe/Madrid",
    "Europe/Moscow",
    "Europe/Paris",
    "Europe/Rome",
    "Europe/Stockholm",
    "Europe/Zurich",
    "Pacific/Auckland",
    "Pacific/Honolulu",
    "Pacific/Tahiti",
] as const;

export function getTimeZoneOptions(): string[] {
    const maybeIntl = Intl as unknown as {
        supportedValuesOf?: (key: string) => string[];
    };
    if (typeof maybeIntl.supportedValuesOf === "function") {
        const values = maybeIntl.supportedValuesOf("timeZone");
        if (Array.isArray(values) && values.length > 0) {
            return values.includes("UTC") ? values : ["UTC", ...values];
        }
    }
    return [...FALLBACK_TIMEZONES];
}

export function formatTimeZoneLabel(timeZone: string): string {
    return timeZone.replace(/_/g, " ");
}
