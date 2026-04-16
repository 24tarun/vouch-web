"use client";

import { useCallback, useReducer, useSyncExternalStore } from "react";

export function useCollapsibleSection(sessionKey: string) {
    const [, forceRender] = useReducer((value: number) => value + 1, 0);
    const subscribe = useCallback((onStoreChange: () => void) => {
        if (typeof window === "undefined") {
            return () => {};
        }

        const handleStorage = (event: StorageEvent) => {
            if (event.storageArea !== window.sessionStorage) return;
            if (event.key !== null && event.key !== sessionKey) return;
            onStoreChange();
        };

        window.addEventListener("storage", handleStorage);
        return () => {
            window.removeEventListener("storage", handleStorage);
        };
    }, [sessionKey]);

    const getSnapshot = useCallback(() => {
        if (typeof window === "undefined") return false;
        try {
            return window.sessionStorage.getItem(sessionKey) === "1";
        } catch {
            return false;
        }
    }, [sessionKey]);

    const isOpen = useSyncExternalStore(subscribe, getSnapshot, () => false);

    const toggle = useCallback(() => {
        const next = !isOpen;
        try {
            if (next) {
                window.sessionStorage.setItem(sessionKey, "1");
            } else {
                window.sessionStorage.removeItem(sessionKey);
            }
        } catch {
            // Ignore sessionStorage write failures.
        }
        // Storage events do not fire in the same tab that writes sessionStorage.
        forceRender();
    }, [forceRender, isOpen, sessionKey]);

    return [isOpen, toggle] as const;
}
