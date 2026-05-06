"use client";

import { useState, useEffect, useCallback } from "react";
import { saveSubscription } from "@/actions/push";
import { haptics } from "@/lib/haptics";

const VAPID_PUBLIC_KEY = normalizeVapidPublicKey(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "");

interface PushInitializerProps {
    autoPrompt?: boolean;
}

export function PushInitializer({ autoPrompt = false }: PushInitializerProps) {
    const hasVapidKey = VAPID_PUBLIC_KEY.length > 0;
    const supportsPush =
        hasVapidKey &&
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;

    const [isSubscribed, setIsSubscribed] = useState<boolean | null>(null);
    const [permission, setPermission] = useState<NotificationPermission>(() => {
        if (typeof window === "undefined" || !("Notification" in window)) {
            return "default";
        }
        return Notification.permission;
    });
    const [error, setError] = useState<string | null>(null);
    const [isSubscribing, setIsSubscribing] = useState(false);

    useEffect(() => {
        if (!supportsPush) return;

        let cancelled = false;

        navigator.serviceWorker.ready.then(async (reg) => {
            try {
                const sub = await reg.pushManager.getSubscription();
                if (cancelled) return;
                setIsSubscribed(!!sub);
                setPermission(Notification.permission);
            } catch {
                if (cancelled) return;
                setIsSubscribed(false);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [supportsPush]);

    const subscribe = useCallback(async (options?: { silent?: boolean; skipHaptics?: boolean }) => {
        if (isSubscribing) return;
        try {
            setIsSubscribing(true);
            setError(null);
            if (!options?.skipHaptics) {
                haptics.light();
            }
            const status = await Notification.requestPermission();
            setPermission(status);

            if (status === "denied") {
                if (!options?.skipHaptics) haptics.error();
                if (!options?.silent) {
                    setError("Notification permission denied. Enable notifications in browser settings.");
                }
                return;
            }

            if (status !== "granted") {
                if (!options?.silent) {
                    setError("Notification permission was dismissed.");
                }
                return;
            }

            if (!hasVapidKey) {
                haptics.error();
                setError("Push is not configured. Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY.");
                return;
            }

            const reg = await navigator.serviceWorker.ready;
            let applicationServerKey: Uint8Array;
            try {
                applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
            } catch {
                haptics.error();
                setError("NEXT_PUBLIC_VAPID_PUBLIC_KEY is malformed. Regenerate VAPID keys and redeploy.");
                return;
            }
            if (!isLikelyValidVapidPublicKey(applicationServerKey)) {
                haptics.error();
                setError("NEXT_PUBLIC_VAPID_PUBLIC_KEY is invalid (expected a 65-byte uncompressed key).");
                return;
            }

            const sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: applicationServerKey as BufferSource,
            });

            const result = await saveSubscription(JSON.parse(JSON.stringify(sub)));
            if (result.success) {
                setIsSubscribed(true);
                setError(null);
                if (!options?.skipHaptics) haptics.medium();
            } else if (result.error) {
                if (!options?.skipHaptics) haptics.error();
                setError(result.error);
            }
        } catch (err) {
            console.error("Subscription failed:", err);
            if (!options?.skipHaptics) haptics.error();
            if (err instanceof DOMException && err.name === "AbortError") {
                if (!options?.silent) {
                    setError(
                        "Push registration failed. Check VAPID key pair/environment variables and browser push service availability."
                    );
                }
                return;
            }
            if (!options?.silent) {
                setError(err instanceof Error ? err.message : "Subscription failed.");
            }
        } finally {
            setIsSubscribing(false);
        }
    }, [hasVapidKey, isSubscribing]);

    useEffect(() => {
        if (!autoPrompt || !supportsPush || isSubscribed !== false || isSubscribing) return;
        if (permission !== "default") return;
        void subscribe({ silent: true, skipHaptics: true });
    }, [autoPrompt, isSubscribed, isSubscribing, permission, subscribe, supportsPush]);

    if (!hasVapidKey) {
        return (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-bold text-amber-200 uppercase tracking-wider">Push Not Configured</h3>
                <p className="text-xs text-amber-100/80 font-mono mt-1">
                    Missing <code>NEXT_PUBLIC_VAPID_PUBLIC_KEY</code>. Add VAPID keys to enable mobile push.
                </p>
            </div>
        );
    }

    if (!supportsPush) {
        return (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Push Unavailable</h3>
                <p className="text-xs text-slate-500 font-mono mt-1">
                    This browser does not support Web Push in the current mode.
                </p>
            </div>
        );
    }

    if (isSubscribed === null) return null;
    if (isSubscribed || permission === "denied") return null;

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Enable Mobile Notifications</h3>
                    <p className="text-xs text-slate-500 font-mono mt-1">Get updates on your phone for task deadlines and voucher actions.</p>
                </div>
                <button
                    onClick={() => void subscribe()}
                    className="px-4 py-2 bg-slate-200 hover:bg-white text-slate-900 text-[10px] font-bold uppercase tracking-widest rounded transition-colors"
                >
                    Enable
                </button>
            </div>
            {error && (
                <p className="text-xs text-red-300 font-mono mt-3">{error}</p>
            )}
        </div>
    );
}

function urlBase64ToUint8Array(base64String: string) {
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

function normalizeVapidPublicKey(value: string) {
    return value.trim().replace(/^['"]|['"]$/g, "").replace(/\s+/g, "");
}

function isLikelyValidVapidPublicKey(key: Uint8Array) {
    return key.byteLength === 65 && key[0] === 0x04;
}
