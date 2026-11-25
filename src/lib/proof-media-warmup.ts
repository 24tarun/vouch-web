"use client";

interface WarmProofEntry {
    taskId: string;
    version: string;
    src: string;
    touchedAt: number;
}

const MAX_WARMED_IMAGES = 40;

const warmedByKey = new Map<string, WarmProofEntry>();
const warmKeyByTaskId = new Map<string, string>();
const inFlightByKey = new Map<string, Promise<string | null>>();
const taskEpochById = new Map<string, number>();

function buildWarmKey(taskId: string, version: string): string {
    return `${taskId}:${version}`;
}

function getTaskEpoch(taskId: string): number {
    return taskEpochById.get(taskId) || 0;
}

function bumpTaskEpoch(taskId: string): number {
    const next = getTaskEpoch(taskId) + 1;
    taskEpochById.set(taskId, next);
    return next;
}

function touchEntry(key: string) {
    const existing = warmedByKey.get(key);
    if (!existing) return;
    existing.touchedAt = Date.now();
}

function removeWarmEntry(key: string) {
    const existing = warmedByKey.get(key);
    if (!existing) return;
    warmedByKey.delete(key);
    if (warmKeyByTaskId.get(existing.taskId) === key) {
        warmKeyByTaskId.delete(existing.taskId);
    }
    URL.revokeObjectURL(existing.src);
}

function evictIfNeeded() {
    while (warmedByKey.size > MAX_WARMED_IMAGES) {
        let oldestKey: string | null = null;
        let oldestTouched = Number.POSITIVE_INFINITY;

        for (const [key, entry] of warmedByKey.entries()) {
            if (entry.touchedAt >= oldestTouched) continue;
            oldestTouched = entry.touchedAt;
            oldestKey = key;
        }

        if (!oldestKey) return;
        removeWarmEntry(oldestKey);
    }
}

function invalidateTaskEntry(taskId: string, keepKey?: string) {
    const currentKey = warmKeyByTaskId.get(taskId);
    if (!currentKey) return;
    if (keepKey && currentKey === keepKey) return;
    removeWarmEntry(currentKey);
}

function clearInFlightForTask(taskId: string) {
    const prefix = `${taskId}:`;
    for (const key of Array.from(inFlightByKey.keys())) {
        if (!key.startsWith(prefix)) continue;
        inFlightByKey.delete(key);
    }
}

export function shouldSkipAutoWarmup(): boolean {
    if (typeof navigator === "undefined") return false;
    const navWithConnection = navigator as Navigator & {
        connection?: {
            saveData?: boolean;
        };
    };
    return Boolean(navWithConnection.connection?.saveData);
}

export function getWarmProofSrc(taskId: string, version: string): string | null {
    if (!taskId || !version) return null;
    const key = buildWarmKey(taskId, version);
    const existing = warmedByKey.get(key);
    if (!existing) return null;
    touchEntry(key);
    return existing.src;
}

export function invalidateWarmProofForTask(taskId: string): void {
    if (!taskId) return;
    bumpTaskEpoch(taskId);
    invalidateTaskEntry(taskId);
    clearInFlightForTask(taskId);
}

export async function purgeLocalProofMedia(taskId: string): Promise<void> {
    if (!taskId) return;
    invalidateWarmProofForTask(taskId);

    if (typeof window === "undefined") return;
    if (!("caches" in window)) return;

    const targetPath = `/api/task-proofs/${taskId}`;
    try {
        const cacheNames = await window.caches.keys();
        await Promise.all(cacheNames.map(async (cacheName) => {
            const cache = await window.caches.open(cacheName);
            const requests = await cache.keys();
            await Promise.all(requests.map(async (request) => {
                if (!request.url.includes(targetPath)) return;
                await cache.delete(request);
            }));
        }));
    } catch {
    }
}

export async function warmProofImage(
    taskId: string,
    version: string,
    url: string,
    signal?: AbortSignal
): Promise<string | null> {
    if (!taskId || !version || !url) return null;

    const key = buildWarmKey(taskId, version);
    const currentWarmKey = warmKeyByTaskId.get(taskId);
    if (currentWarmKey && currentWarmKey !== key) {
        invalidateWarmProofForTask(taskId);
    }

    const startEpoch = getTaskEpoch(taskId);
    const existing = warmedByKey.get(key);
    if (existing) {
        touchEntry(key);
        return existing.src;
    }

    const existingInFlight = inFlightByKey.get(key);
    if (existingInFlight) {
        return existingInFlight;
    }

    const warmPromise = (async () => {
        try {
            const response = await fetch(url, {
                method: "GET",
                cache: "no-store",
                credentials: "same-origin",
                signal,
            });

            if (!response.ok) return null;

            const contentType = response.headers.get("content-type") || "";
            if (!contentType.startsWith("image/")) return null;

            const blob = await response.blob();
            if (blob.size <= 0) return null;

            const objectUrl = URL.createObjectURL(blob);

            if (getTaskEpoch(taskId) !== startEpoch) {
                URL.revokeObjectURL(objectUrl);
                return null;
            }

            invalidateTaskEntry(taskId, key);
            warmedByKey.set(key, {
                taskId,
                version,
                src: objectUrl,
                touchedAt: Date.now(),
            });
            warmKeyByTaskId.set(taskId, key);
            evictIfNeeded();
            return objectUrl;
        } catch {
            return null;
        }
    })();

    inFlightByKey.set(key, warmPromise);
    try {
        return await warmPromise;
    } finally {
        inFlightByKey.delete(key);
    }
}
