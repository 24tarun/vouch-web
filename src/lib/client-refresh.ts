"use client";

async function clearBrowserCaches(): Promise<void> {
    if (!("caches" in window)) return;

    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys.map((key) => caches.delete(key)));
}

async function updateServiceWorkers(): Promise<void> {
    if (!("serviceWorker" in navigator)) return;

    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
        registrations.map((registration) =>
            registration.update().catch(() => undefined)
        )
    );
}

export async function invalidateClientCachesAndReload(): Promise<void> {
    if (typeof window === "undefined") return;

    await Promise.allSettled([clearBrowserCaches(), updateServiceWorkers()]);

    window.location.reload();
}
