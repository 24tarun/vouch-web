export function normalizeVapidPublicKey(value: string): string {
    return value.trim().replace(/^['"]|['"]$/g, "").replace(/\s+/g, "");
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const normalized = normalizeVapidPublicKey(base64String);
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const base64 = (normalized + padding).replace(/\-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

export function isLikelyValidVapidPublicKey(key: Uint8Array): boolean {
    return key.byteLength === 65 && key[0] === 0x04;
}
