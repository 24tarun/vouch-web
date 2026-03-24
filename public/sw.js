const SW_VERSION = 'v5';
const STATIC_CACHE = `tas-static-${SW_VERSION}`;
const PAGE_CACHE = `tas-pages-${SW_VERSION}`;
const RUNTIME_CACHE = `tas-runtime-${SW_VERSION}`;
const APP_SHELL_ASSETS = ['/icon-192.png', '/icon-512.png', '/favicon.png'];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(STATIC_CACHE)
            .then((cache) => cache.addAll(APP_SHELL_ASSETS))
            .catch(() => undefined)
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((key) => key.startsWith('tas-') && ![STATIC_CACHE, PAGE_CACHE, RUNTIME_CACHE].includes(key))
                        .map((key) => caches.delete(key))
                )
            )
            .then(() => clients.claim())
    );
});

function isSameOrigin(url) {
    return url.origin === self.location.origin;
}

function isNavigationRequest(request) {
    return request.mode === 'navigate' || request.destination === 'document';
}

function isRscRequest(url, request) {
    return url.searchParams.has('_rsc') || request.headers.get('RSC') === '1';
}

function isStaticAsset(url) {
    return (
        url.pathname.startsWith('/_next/static/') ||
        url.pathname.startsWith('/_next/image') ||
        /\.(?:js|css|png|jpg|jpeg|svg|gif|webp|ico|woff2?|ttf)$/i.test(url.pathname)
    );
}

function shouldBypass(url, request) {
    if (request.method !== 'GET') return true;
    if (!isSameOrigin(url)) return true;
    if (url.pathname.startsWith('/api')) return true;
    return false;
}

function isSensitivePage(url) {
    return (
        url.pathname.startsWith('/dashboard') ||
        url.pathname.startsWith('/login') ||
        url.pathname.startsWith('/auth')
    );
}

async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);

    const networkPromise = fetch(request)
        .then((response) => {
            if (response && response.ok) {
                cache.put(request, response.clone()).catch(() => undefined);
            }
            return response;
        })
        .catch(() => undefined);

    return cached || networkPromise || fetch(request);
}

async function networkFirst(request, cacheName) {
    const cache = await caches.open(cacheName);

    try {
        const response = await fetch(request);
        if (response && response.ok) {
            cache.put(request, response.clone()).catch(() => undefined);
        }
        return response;
    } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw new Error('Network request failed and no cache available.');
    }
}

self.addEventListener('fetch', (event) => {
    const { request } = event;

    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
        return;
    }

    const url = new URL(request.url);
    if (shouldBypass(url, request)) {
        return;
    }

    if (isStaticAsset(url)) {
        event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
        return;
    }

    if (isNavigationRequest(request) || isRscRequest(url, request)) {
        if (isSensitivePage(url)) {
            event.respondWith(fetch(request));
            return;
        }
        event.respondWith(networkFirst(request, PAGE_CACHE));
        return;
    }

    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});

self.addEventListener('push', (event) => {
    let payload = {
        title: 'TAS',
        body: 'You have a new notification.',
        url: '/tasks',
        tag: undefined,
        sound: undefined,
        data: {},
    };

    if (event.data) {
        try {
            const json = event.data.json();
            payload = {
                title: json?.title || payload.title,
                body: json?.body || payload.body,
                url: json?.url || payload.url,
                tag: json?.tag,
                sound: json?.sound,
                data: json?.data || {},
            };
        } catch {
            const text = event.data.text();
            if (text) payload.body = text;
        }
    }

    const notifyPromise = self.registration.showNotification(payload.title, {
        body: payload.body,
        tag: payload.tag,
        renotify: Boolean(payload.tag),
        requireInteraction: false,
        silent: false,
        vibrate: [20, 40, 20],
        data: { ...(payload.data || {}), url: payload.url },
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        actions: [{ action: 'open', title: 'Open' }],
    });

    const soundPromise = payload.sound
        ? clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            windowClients.forEach((client) => {
                client.postMessage({
                    type: 'tas-play-sound',
                    sound: payload.sound,
                });
            });
        })
        : Promise.resolve();

    event.waitUntil(Promise.all([notifyPromise, soundPromise]));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const notificationData = event.notification.data || {};
    const rawTargetUrl = notificationData.url || '/tasks';
    const targetUrl = new URL(rawTargetUrl, self.location.origin).href;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            const matchingClient = windowClients.find((client) => client.url === targetUrl);
            if (matchingClient && 'focus' in matchingClient) {
                return matchingClient.focus();
            }

            const sameOriginClient = windowClients.find(
                (client) => new URL(client.url).origin === self.location.origin
            );
            if (sameOriginClient && 'navigate' in sameOriginClient) {
                return sameOriginClient.navigate(targetUrl).then((navigatedClient) => navigatedClient?.focus());
            }

            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }

            return undefined;
        })
    );
});
