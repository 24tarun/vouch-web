import { getFailureCostBounds, type SupportedCurrency } from "@/lib/currency";
import { MAX_POMO_DURATION_MINUTES } from "@/lib/constants";
import type { Charity } from "@/lib/types";

export function clampFailureCostToCurrencyBounds(rawValue: string, targetCurrency: SupportedCurrency): string {
    const targetBounds = getFailureCostBounds(targetCurrency);
    const parsed = Number(rawValue);
    const normalized = Number.isFinite(parsed) ? parsed : targetBounds.minMajor;
    const clamped = Math.min(targetBounds.maxMajor, Math.max(targetBounds.minMajor, normalized));

    return targetBounds.step < 1
        ? clamped.toFixed(2)
        : Math.round(clamped).toString();
}

export interface BuildDefaultsFormDataInput {
    defaultPomoDurationMinutes: string;
    defaultEventDurationMinutes: string;
    defaultFailureCostEuros: string;
    effectiveDefaultVoucherId: string;
    deadlineOneHourWarningEnabled: boolean;
    deadlineFinalWarningEnabled: boolean;
    voucherCanViewActiveTasksEnabled: boolean;
    defaultRequiresProofForAllTasks: boolean;
    mobileNotificationsEnabled: boolean;
    currency: SupportedCurrency;
    timeZone: string;
    timeZoneUserSet: boolean;
    charityEnabled: boolean;
    selectedCharityId: string;
}

export function buildDefaultsFormData(input: BuildDefaultsFormDataInput): FormData {
    const formData = new FormData();
    formData.append("defaultPomoDurationMinutes", input.defaultPomoDurationMinutes);
    formData.append("defaultEventDurationMinutes", input.defaultEventDurationMinutes);
    formData.append("defaultFailureCost", input.defaultFailureCostEuros);
    formData.append("defaultVoucherId", input.effectiveDefaultVoucherId ?? "");
    formData.append("deadlineOneHourWarningEnabled", String(input.deadlineOneHourWarningEnabled));
    formData.append("deadlineFinalWarningEnabled", String(input.deadlineFinalWarningEnabled));
    formData.append("voucherCanViewActiveTasksEnabled", String(input.voucherCanViewActiveTasksEnabled));
    formData.append("defaultRequiresProofForAllTasks", String(input.defaultRequiresProofForAllTasks));
    formData.append("mobileNotificationsEnabled", String(input.mobileNotificationsEnabled));
    formData.append("currency", input.currency);
    formData.append("timezone", input.timeZone);
    formData.append("timezoneUserSet", String(input.timeZoneUserSet));
    formData.append("charityEnabled", String(input.charityEnabled));
    formData.append("selectedCharityId", input.selectedCharityId);
    return formData;
}

export interface ValidateDefaultsInput {
    defaultPomoDurationMinutes: string;
    defaultEventDurationMinutes: string;
    defaultFailureCostEuros: string;
    currency: SupportedCurrency;
    currencySymbol: string;
    timeZone: string;
    timeZoneOptions: string[];
    charityEnabled: boolean;
    selectedCharityId: string;
    selectedCharity: Charity | null;
}

export function validateDefaultsState(input: ValidateDefaultsInput): string | null {
    const parsedPomo = Number(input.defaultPomoDurationMinutes);
    if (!Number.isFinite(parsedPomo) || !Number.isInteger(parsedPomo) || parsedPomo < 1 || parsedPomo > MAX_POMO_DURATION_MINUTES) {
        return `Default Pomodoro duration must be an integer between 1 and ${MAX_POMO_DURATION_MINUTES}.`;
    }

    const parsedEventDuration = Number(input.defaultEventDurationMinutes);
    if (!Number.isFinite(parsedEventDuration) || !Number.isInteger(parsedEventDuration) || parsedEventDuration < 1 || parsedEventDuration > 720) {
        return "Default event duration must be an integer between 1 and 720.";
    }

    const parsedFailureMajor = Number(input.defaultFailureCostEuros);
    if (!Number.isFinite(parsedFailureMajor)) {
        return "Default failure cost is invalid.";
    }

    const bounds = getFailureCostBounds(input.currency);
    const parsedFailureCents = Math.round(parsedFailureMajor * 100);
    if (parsedFailureCents < bounds.minCents || parsedFailureCents > bounds.maxCents) {
        return `Default failure cost must be between ${input.currencySymbol}${bounds.minMajor} and ${input.currencySymbol}${bounds.maxMajor}.`;
    }

    if (!input.timeZone || !input.timeZoneOptions.includes(input.timeZone)) {
        return "Timezone is invalid.";
    }

    if (input.charityEnabled) {
        if (!input.selectedCharityId) {
            return "Select one charity when Charity Choice is enabled.";
        }
        if (!input.selectedCharity || !input.selectedCharity.is_active) {
            return "Selected charity is unavailable. Choose an active charity.";
        }
    }

    return null;
}
