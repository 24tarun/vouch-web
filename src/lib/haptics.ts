type VibrationPattern = number | number[];

function canVibrate(): boolean {
    if (typeof navigator === "undefined") return false;
    return typeof navigator.vibrate === "function";
}

function trigger(pattern: VibrationPattern): void {
    if (!canVibrate()) return;

    try {
        navigator.vibrate(pattern);
    } catch {
    }
}

export const haptics = {
    light: () => {
        trigger(12);
    },

    medium: () => {
        trigger([18, 16, 18]);
    },

    heavy: () => {
        trigger([28, 18, 28]);
    },

    error: () => {
        trigger([35, 24, 35, 24, 35]);
    },
};

export function hapticsSupported(): boolean {
    return canVibrate();
}
