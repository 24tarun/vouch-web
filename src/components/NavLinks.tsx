'use client';

import { useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Settings, Users } from "lucide-react";

import { haptics } from "@/lib/haptics";

interface NavLinksProps {
    vouchCount?: number;
    statsBadgeCount?: number;
}

interface NetworkInformationLike {
    saveData?: boolean;
    effectiveType?: string;
}

type IdleWindow = Window & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (id: number) => void;
};

export function NavLinks({ vouchCount = 0, statsBadgeCount = 0 }: NavLinksProps) {
    const pathname = usePathname();
    const router = useRouter();
    const prefetchedHrefsRef = useRef<Set<string>>(new Set());

    const links = useMemo(
        () => [
            { href: "/dashboard", label: "Tasks" },
            { href: "/dashboard/stats", label: "Stats", badge: statsBadgeCount > 0 ? statsBadgeCount : undefined },
            { href: "/dashboard/friends", label: "Friends", badge: vouchCount > 0 ? vouchCount : undefined },
            { href: "/dashboard/commitments", label: "Commit" },
            { href: "/dashboard/ledger", label: "Ledger" },
            { href: "/dashboard/settings", label: "Settings" },
        ],
        [statsBadgeCount, vouchCount]
    );

    const prefetchLink = useCallback(
        (href: string) => {
            if (prefetchedHrefsRef.current.has(href)) return;
            prefetchedHrefsRef.current.add(href);
            void router.prefetch(href);
        },
        [router]
    );

    useEffect(() => {
        const idleWindow = window as IdleWindow;
        const uniqueHrefs = [...new Set(links.map((link) => link.href))];
        const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
        const isConstrainedNetwork =
            Boolean(connection?.saveData) ||
            connection?.effectiveType === "slow-2g" ||
            connection?.effectiveType === "2g";
        const hrefsToWarm = isConstrainedNetwork ? uniqueHrefs.slice(0, 3) : uniqueHrefs;
        let cancelled = false;
        let timeoutId: number | null = null;
        let idleId: number | null = null;

        const warmup = () => {
            hrefsToWarm.forEach((href, index) => {
                window.setTimeout(() => {
                    if (cancelled) return;
                    prefetchLink(href);
                }, index * 120);
            });
        };

        if (idleWindow.requestIdleCallback) {
            idleId = idleWindow.requestIdleCallback(warmup, { timeout: 1200 });
        } else {
            timeoutId = window.setTimeout(warmup, 220);
        }

        return () => {
            cancelled = true;
            if (timeoutId !== null) {
                window.clearTimeout(timeoutId);
            }
            if (idleId !== null && idleWindow.cancelIdleCallback) {
                idleWindow.cancelIdleCallback(idleId);
            }
        };
    }, [links, prefetchLink]);

    return (
        <div className="w-full overflow-hidden">
            <div className="grid w-full grid-cols-6 items-center justify-items-center px-1">
                {links.map((link) => {
                    const isActive = pathname === link.href || (link.href !== "/dashboard" && pathname.startsWith(link.href));


                    return (
                        <Link
                            key={`${link.href}-${link.label}`}
                            href={link.href}
                            prefetch
                            className={`relative flex h-8 w-full min-w-0 items-center justify-center whitespace-nowrap text-[10px] sm:text-xs font-mono uppercase leading-none tracking-[0.08em] sm:tracking-[0.12em] transition-colors ${isActive ? "text-white font-bold" : "text-slate-400 hover:text-white"
                                }`}
                            aria-label={link.label}
                            onMouseEnter={() => prefetchLink(link.href)}
                            onFocus={() => prefetchLink(link.href)}
                            onTouchStart={() => prefetchLink(link.href)}
                            onClick={() => haptics.light()}
                        >
                            {link.href === "/dashboard/ledger" ? (
                                <>
                                    <span className="sr-only">Ledger</span>
                                    <span
                                        aria-hidden
                                        className="text-emerald-300 text-[20px] leading-none font-semibold normal-case tracking-normal"
                                        style={{ textShadow: "0 0 8px rgba(52, 211, 153, 0.95), 0 0 14px rgba(52, 211, 153, 0.55)" }}
                                    >
                                        €
                                    </span>
                                    <span
                                        aria-hidden
                                        className="text-red-300 text-[20px] leading-none font-semibold normal-case tracking-normal"
                                        style={{ textShadow: "0 0 8px rgba(248, 113, 113, 0.95), 0 0 14px rgba(248, 113, 113, 0.55)" }}
                                    >
                                        €
                                    </span>
                                </>
                            ) : link.href === "/dashboard/friends" ? (
                                <span
                                    aria-hidden
                                    className={`inline-flex items-center transition-all ${isActive ? "text-blue-100" : "text-white"}`}
                                    style={{
                                        textShadow: isActive
                                            ? "0 0 14px rgba(147, 197, 253, 1), 0 0 30px rgba(59, 130, 246, 1), 0 0 46px rgba(37, 99, 235, 0.98), 0 0 64px rgba(29, 78, 216, 0.9)"
                                            : "none",
                                        filter: isActive
                                            ? "drop-shadow(0 0 10px rgba(147, 197, 253, 1)) drop-shadow(0 0 20px rgba(59, 130, 246, 0.95)) drop-shadow(0 0 32px rgba(29, 78, 216, 0.9))"
                                            : "none",
                                    }}
                                >
                                    <Users className="h-5 w-5" />
                                </span>
                            ) : link.href === "/dashboard/settings" ? (
                                <>
                                    <span className="sr-only">Settings</span>
                                    <span
                                        aria-hidden
                                        className="inline-flex items-center text-amber-300 transition-all"
                                        style={{
                                            textShadow: isActive
                                                ? "0 0 10px rgba(252, 211, 77, 1), 0 0 22px rgba(245, 158, 11, 0.95), 0 0 34px rgba(217, 119, 6, 0.8)"
                                                : "none",
                                            filter: isActive
                                                ? "drop-shadow(0 0 8px rgba(252, 211, 77, 0.95)) drop-shadow(0 0 16px rgba(245, 158, 11, 0.85))"
                                                : "none",
                                        }}
                                    >
                                        <Settings className="h-5 w-5" />
                                    </span>
                                </>
                            ) : (
                                link.label
                            )}
                            {link.badge !== undefined && (
                                <span className="absolute right-[2px] top-[1px] flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white ring-2 ring-slate-950">
                                    {link.badge}
                                </span>
                            )}
                        </Link>
                    );
                })}

            </div>
        </div>
    );
}

