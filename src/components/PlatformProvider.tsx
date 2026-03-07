'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { getPlatform, isNative, Platform } from '@/lib/platform';

const DEFAULT_VIEWPORT_CONTENT = 'width=device-width, initial-scale=1, viewport-fit=cover';
const FOCUSED_VIEWPORT_CONTENT = `${DEFAULT_VIEWPORT_CONTENT}, maximum-scale=1`;

interface StatusBarPlugin {
    setOverlaysWebView?: (options: { overlay: boolean }) => Promise<void> | void;
    setStyle?: (options: { style: 'LIGHT' | 'DARK' }) => Promise<void> | void;
    setBackgroundColor?: (options: { color: string }) => Promise<void> | void;
}

interface PlatformContextType {
    platform: Platform;
    isNative: boolean;
    isIOS: boolean;
    isAndroid: boolean;
    isMobile: boolean;
}

const PlatformContext = createContext<PlatformContextType | undefined>(undefined);

function getInitialPlatformContext(): PlatformContextType {
    const platform = getPlatform();
    const native = typeof window !== 'undefined' ? isNative() : false;

    return {
        platform,
        isNative: native,
        isIOS: platform === 'ios',
        isAndroid: platform === 'android',
        isMobile: platform === 'ios' || platform === 'android',
    };
}

export function PlatformProvider({ children }: { children: React.ReactNode }) {
    const [value] = useState<PlatformContextType>(getInitialPlatformContext);

    useEffect(() => {
        // Keep iOS native view edge-to-edge; fallback to black status area if overlay is ignored.
        if (value.isNative && value.platform === 'ios') {
            const statusBar = (window as unknown as {
                Capacitor?: { Plugins?: { StatusBar?: StatusBarPlugin } };
            })?.Capacitor?.Plugins?.StatusBar;
            if (statusBar) {
                Promise.resolve(statusBar.setOverlaysWebView?.({ overlay: true })).catch(() => { });
                Promise.resolve(statusBar.setStyle?.({ style: 'LIGHT' })).catch(() => { });
                Promise.resolve(statusBar.setBackgroundColor?.({ color: '#000000' })).catch(() => { });
            }
        }
    }, [value.isNative, value.platform]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!value.isMobile) return;

        const viewportMeta = document.querySelector('meta[name="viewport"]');
        if (!viewportMeta) return;

        let resetHandle = 0;

        const isFormControl = (target: EventTarget | null): boolean =>
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            target instanceof HTMLSelectElement;

        const setViewportContent = (content: string) => {
            if (viewportMeta.getAttribute('content') !== content) {
                viewportMeta.setAttribute('content', content);
            }
        };

        const lockViewportZoom = () => {
            window.clearTimeout(resetHandle);
            setViewportContent(FOCUSED_VIEWPORT_CONTENT);
        };

        const restoreViewportZoom = () => {
            window.clearTimeout(resetHandle);
            resetHandle = window.setTimeout(() => {
                const activeElement = document.activeElement;
                if (isFormControl(activeElement)) return;
                setViewportContent(DEFAULT_VIEWPORT_CONTENT);
            }, 0);
        };

        const handleFocusIn = (event: FocusEvent) => {
            if (!isFormControl(event.target)) return;
            lockViewportZoom();
        };

        const handleFocusOut = (event: FocusEvent) => {
            if (!isFormControl(event.target)) return;
            restoreViewportZoom();
        };

        document.addEventListener('focusin', handleFocusIn);
        document.addEventListener('focusout', handleFocusOut);

        return () => {
            window.clearTimeout(resetHandle);
            document.removeEventListener('focusin', handleFocusIn);
            document.removeEventListener('focusout', handleFocusOut);
            setViewportContent(DEFAULT_VIEWPORT_CONTENT);
        };
    }, [value.isMobile]);

    return (
        <PlatformContext.Provider value={value}>
            {children}
        </PlatformContext.Provider>
    );
}

export function usePlatformContext() {
    const context = useContext(PlatformContext);
    if (context === undefined) {
        throw new Error('usePlatformContext must be used within a PlatformProvider');
    }
    return context;
}
