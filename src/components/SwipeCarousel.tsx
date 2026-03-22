"use client";

import { usePathname, useRouter } from "next/navigation";
import { useRef, useEffect, useCallback } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { haptics } from "@/lib/haptics";

const PAGES = [
    "/dashboard",
    "/dashboard/stats",
    "/dashboard/friends",
    "/dashboard/commitments",
    "/dashboard/ledger",
    "/dashboard/settings",
] as const;

type PagePath = (typeof PAGES)[number];

function Skeleton() {
    return (
        <div style={{ padding: "4px 0", display: "flex", flexDirection: "column", gap: "14px" }}>
            {[70, 45, 80, 50, 60].map((w, i) => (
                <div
                    key={i}
                    style={{
                        height: i === 0 ? 28 : 14,
                        width: `${w}%`,
                        background: "#1e293b",
                        borderRadius: 3,
                        opacity: 0.5,
                    }}
                />
            ))}
        </div>
    );
}

export function SwipeCarousel({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const containerRef = useRef<HTMLDivElement>(null);
    const widthRef = useRef(0);
    const isAnimating = useRef(false);

    // Page content cache: path → rendered children
    const cache = useRef<Map<string, React.ReactNode>>(new Map());

    // Motion value driving all three slots
    const x = useMotionValue(0);

    // Reset position on navigation
    useEffect(() => {
        x.set(0);
        isAnimating.current = false;
    }, [pathname, x]);

    // Cache children only when they belong to the current path.
    // When Next.js navigates with startTransition, pathname changes immediately
    // but children stays as the old page during loading — we must skip that render
    // to avoid poisoning the cache with stale content.
    const prevCachePathRef = useRef(pathname);
    useEffect(() => {
        if (prevCachePathRef.current === pathname) {
            cache.current.set(pathname, children);
        }
        prevCachePathRef.current = pathname;
    }, [pathname, children]);

    // Prefetch all dashboard pages on mount so every swipe is instant
    useEffect(() => {
        PAGES.forEach(path => router.prefetch(path));
    }, [router]);

    // Track container width
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        widthRef.current = el.offsetWidth;
        const ro = new ResizeObserver(([entry]) => {
            widthRef.current = entry.contentRect.width;
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const idx = PAGES.indexOf(pathname as PagePath);
    const prevPath = idx > 0 ? PAGES[idx - 1] : null;
    const nextPath = idx < PAGES.length - 1 ? PAGES[idx + 1] : null;

    const prevContent = prevPath
        ? (cache.current.get(prevPath) ?? <Skeleton />)
        : null;
    const nextContent = nextPath
        ? (cache.current.get(nextPath) ?? <Skeleton />)
        : null;

    const snapTo = useCallback(
        async (dir: "prev" | "next") => {
            if (isAnimating.current) return;
            isAnimating.current = true;

            const w = widthRef.current || window.innerWidth;
            const target = dir === "prev" ? w : -w;
            const path = dir === "prev" ? prevPath : nextPath;

            await animate(x, target, {
                type: "spring",
                stiffness: 320,
                damping: 34,
                mass: 0.85,
            });

            haptics.light();
            if (path) router.push(path);
            // x resets in the pathname useEffect when new page mounts
        },
        [x, prevPath, nextPath, router],
    );

    const snapBack = useCallback(() => {
        animate(x, 0, { type: "spring", stiffness: 380, damping: 38 });
    }, [x]);

    // Touch gesture — manual axis detection so vertical scroll still works
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        let sx = 0, sy = 0, st = 0;
        let axis: "h" | "v" | null = null;
        let dragging = false;

        const onTouchStart = (e: TouchEvent) => {
            const t = e.touches[0];
            sx = t.clientX;
            sy = t.clientY;
            st = Date.now();
            axis = null;
            dragging = false;
        };

        const onTouchMove = (e: TouchEvent) => {
            if (isAnimating.current) return;
            const t = e.touches[0];
            const dx = t.clientX - sx;
            const dy = t.clientY - sy;

            if (axis === null) {
                if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
                    axis = Math.abs(dx) >= Math.abs(dy) ? "h" : "v";
                }
                return;
            }
            if (axis === "v") return;

            // Confirmed horizontal — prevent scroll
            e.preventDefault();
            dragging = true;

            const w = widthRef.current || window.innerWidth;
            let clamped = dx;

            // Rubber-band resist at the first/last page
            if (dx > 0 && !prevPath) clamped = dx * 0.1;
            if (dx < 0 && !nextPath) clamped = dx * 0.1;

            // Soft resist beyond 60% of screen
            const cap = w * 0.6;
            if (Math.abs(clamped) > cap) {
                clamped = Math.sign(clamped) * (cap + (Math.abs(clamped) - cap) * 0.15);
            }

            x.set(clamped);
        };

        const onTouchEnd = (e: TouchEvent) => {
            if (!dragging || isAnimating.current) return;
            const dx = e.changedTouches[0].clientX - sx;
            const dt = Math.max(1, Date.now() - st);
            const vel = (dx / dt) * 1000; // px/s
            const w = widthRef.current || window.innerWidth;

            if ((dx < -w * 0.25 || vel < -400) && nextPath) snapTo("next");
            else if ((dx > w * 0.25 || vel > 400) && prevPath) snapTo("prev");
            else snapBack();
        };

        el.addEventListener("touchstart", onTouchStart, { passive: true });
        el.addEventListener("touchmove", onTouchMove, { passive: false });
        el.addEventListener("touchend", onTouchEnd, { passive: true });

        return () => {
            el.removeEventListener("touchstart", onTouchStart);
            el.removeEventListener("touchmove", onTouchMove);
            el.removeEventListener("touchend", onTouchEnd);
        };
    }, [x, prevPath, nextPath, snapTo, snapBack]);

    // Slot transforms — prev and next are offset by ±containerWidth from x
    const prevX = useTransform(x, v => v - (widthRef.current || window.innerWidth));
    const nextX = useTransform(x, v => v + (widthRef.current || window.innerWidth));

    return (
        // overflow-x: clip clips without creating a scroll container (unlike hidden)
        // so position:sticky inside pages still works
        <div ref={containerRef} style={{ position: "relative", overflowX: "clip" }}>

            {/* Left slot — previous page */}
            {prevContent && (
                <motion.div
                    aria-hidden
                    style={{
                        position: "absolute",
                        top: 0, left: 0,
                        width: "100%",
                        translateX: prevX,
                        pointerEvents: "none",
                        userSelect: "none",
                    }}
                >
                    {prevContent}
                </motion.div>
            )}

            {/* Center slot — current page (in flow, sets container height) */}
            <motion.div style={{ translateX: x }}>
                {children}
            </motion.div>

            {/* Right slot — next page */}
            {nextContent && (
                <motion.div
                    aria-hidden
                    style={{
                        position: "absolute",
                        top: 0, left: 0,
                        width: "100%",
                        translateX: nextX,
                        pointerEvents: "none",
                        userSelect: "none",
                    }}
                >
                    {nextContent}
                </motion.div>
            )}
        </div>
    );
}
