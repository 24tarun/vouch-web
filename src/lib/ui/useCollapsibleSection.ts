"use client";

import { useState, useCallback } from "react";

export function useCollapsibleSection(sessionKey: string) {
    const [isOpen, setIsOpen] = useState<boolean>(() => {
        if (typeof window === "undefined") return false;
        try {
            return window.sessionStorage.getItem(sessionKey) === "1";
        } catch {
            return false;
        }
    });

    const toggle = useCallback(() => {
        setIsOpen((prev) => {
            const next = !prev;
            if (typeof window !== "undefined") {
                try {
                    if (next) {
                        window.sessionStorage.setItem(sessionKey, "1");
                    } else {
                        window.sessionStorage.removeItem(sessionKey);
                    }
                } catch {
                    // Ignore sessionStorage write failures.
                }
            }
            return next;
        });
    }, [sessionKey]);

    return [isOpen, toggle] as const;
}
