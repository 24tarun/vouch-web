'use client';

import { useEffect } from 'react';

type WebkitWindow = Window & {
    webkitAudioContext?: typeof AudioContext;
};

function playPomoAutoEndSound() {
    if (typeof window === 'undefined') return;

    try {
        const audioWindow = window as WebkitWindow;
        const AudioCtx = window.AudioContext || audioWindow.webkitAudioContext;
        if (!AudioCtx) return;

        const ctx = new AudioCtx();
        const startAt = ctx.currentTime + 0.01;

        const playBeep = (offset: number, frequency: number) => {
            const oscillator = ctx.createOscillator();
            const gain = ctx.createGain();

            oscillator.type = 'sine';
            oscillator.frequency.value = frequency;
            gain.gain.setValueAtTime(0.0001, startAt + offset);
            gain.gain.exponentialRampToValueAtTime(0.14, startAt + offset + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + 0.2);

            oscillator.connect(gain);
            gain.connect(ctx.destination);
            oscillator.start(startAt + offset);
            oscillator.stop(startAt + offset + 0.22);
        };

        playBeep(0, 880);
        playBeep(0.24, 988);

        window.setTimeout(() => {
            void ctx.close();
        }, 1200);
    } catch {
        // Best-effort sound playback. Ignore unsupported/browser-blocked playback.
    }
}

function playDefaultNotificationSound() {
    if (typeof window === 'undefined') return;

    try {
        const audioWindow = window as WebkitWindow;
        const AudioCtx = window.AudioContext || audioWindow.webkitAudioContext;
        if (!AudioCtx) return;

        const ctx = new AudioCtx();
        const startAt = ctx.currentTime + 0.01;

        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();

        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(1046.5, startAt);
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.1, startAt + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.16);

        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(startAt);
        oscillator.stop(startAt + 0.18);

        window.setTimeout(() => {
            void ctx.close();
        }, 600);
    } catch {
        // Best-effort sound playback. Ignore unsupported/browser-blocked playback.
    }
}

export function PWARegistration() {
    useEffect(() => {
        if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

        let cancelled = false;

        const register = async () => {
            try {
                const registration = await navigator.serviceWorker.register('/sw.js');
                if (cancelled) return;

                // Ask the browser to check for updates early instead of waiting for a full page lifecycle.
                void registration.update();
                console.log('SW registered:', registration);
            } catch (err) {
                if (!cancelled) {
                    console.error('SW registration failed:', err);
                }
            }
        };

        const handleServiceWorkerMessage = (event: MessageEvent) => {
            const payload = event.data as { type?: string; sound?: string } | undefined;
            if (!payload || payload.type !== 'tas-play-sound') return;
            if (payload.sound === 'pomo-auto-end') {
                playPomoAutoEndSound();
                return;
            }
            playDefaultNotificationSound();
        };

        navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
        void register();

        return () => {
            cancelled = true;
            navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
        };
    }, []);

    return null;
}
