'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Settings, Users } from "lucide-react";

import { haptics } from "@/lib/haptics";
import { createClient } from "@/lib/supabase/client";
import {
    getFriendsVouchRequestsSeenStorageKey,
    getSettingsFriendRequestsSeenStorageKey,
} from "@/lib/settings-badge";

interface NavLinksProps {
    userId?: string;
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

export function NavLinks({ userId, statsBadgeCount = 0 }: NavLinksProps) {
    const pathname = usePathname();
    const router = useRouter();
    const prefetchedHrefsRef = useRef<Set<string>>(new Set());
    const supabaseRef = useRef(createClient());
    const [settingsBadgeSeenAt, setSettingsBadgeSeenAt] = useState<string | null>(null);
    const [settingsBadgeCount, setSettingsBadgeCount] = useState(0);
    const [settingsBadgeReady, setSettingsBadgeReady] = useState(false);
    const [friendsBadgeSeenAt, setFriendsBadgeSeenAt] = useState<string | null>(null);
    const [friendsBadgeCount, setFriendsBadgeCount] = useState(0);
    const [friendsBadgeReady, setFriendsBadgeReady] = useState(false);

    const markSettingsBadgeSeen = useCallback(
        (visitedAt: string = new Date().toISOString()) => {
            if (!userId) return;
            setSettingsBadgeSeenAt(visitedAt);
            setSettingsBadgeCount(0);
            window.localStorage.setItem(
                getSettingsFriendRequestsSeenStorageKey(userId),
                visitedAt
            );
        },
        [userId]
    );

    const markFriendsBadgeSeen = useCallback(
        (visitedAt: string = new Date().toISOString()) => {
            if (!userId) return;
            setFriendsBadgeSeenAt(visitedAt);
            setFriendsBadgeCount(0);
            window.localStorage.setItem(
                getFriendsVouchRequestsSeenStorageKey(userId),
                visitedAt
            );
        },
        [userId]
    );

    useEffect(() => {
        if (!userId) {
            setSettingsBadgeSeenAt(null);
            setSettingsBadgeCount(0);
            setSettingsBadgeReady(true);
            setFriendsBadgeSeenAt(null);
            setFriendsBadgeCount(0);
            setFriendsBadgeReady(true);
            return;
        }

        setSettingsBadgeReady(false);
        const storedSeenAt = window.localStorage.getItem(
            getSettingsFriendRequestsSeenStorageKey(userId)
        );
        setSettingsBadgeSeenAt(storedSeenAt);
        setSettingsBadgeReady(true);

        setFriendsBadgeReady(false);
        const storedFriendsSeenAt = window.localStorage.getItem(
            getFriendsVouchRequestsSeenStorageKey(userId)
        );
        setFriendsBadgeSeenAt(storedFriendsSeenAt);
        setFriendsBadgeReady(true);
    }, [userId]);

    useEffect(() => {
        if (!userId || !(pathname === "/settings" || pathname.startsWith("/settings/"))) return;
        markSettingsBadgeSeen();
    }, [markSettingsBadgeSeen, pathname, userId]);

    useEffect(() => {
        if (!userId || !(pathname === "/friends" || pathname.startsWith("/friends/"))) return;
        markFriendsBadgeSeen();
    }, [markFriendsBadgeSeen, pathname, userId]);

    useEffect(() => {
        if (!userId || !settingsBadgeReady) return;

        const supabase = supabaseRef.current;
        let isActive = true;

        const refreshSettingsBadgeCount = async () => {
            let query = supabase
                .from("friend_requests")
                .select("id", { count: "exact", head: true })
                .eq("receiver_id", userId)
                .eq("status", "PENDING");

            if (settingsBadgeSeenAt) {
                query = query.gt("created_at", settingsBadgeSeenAt);
            }

            const { count, error } = await query;
            if (!isActive || error) return;
            setSettingsBadgeCount(count ?? 0);
        };

        void refreshSettingsBadgeCount();

        const channel = supabase
            .channel(`settings-friend-request-badge:${userId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "friend_requests",
                    filter: `receiver_id=eq.${userId}`,
                },
                () => {
                    void refreshSettingsBadgeCount();
                }
            )
            .subscribe();

        return () => {
            isActive = false;
            void supabase.removeChannel(channel);
        };
    }, [settingsBadgeReady, settingsBadgeSeenAt, userId]);

    useEffect(() => {
        if (!userId || !friendsBadgeReady) return;

        const supabase = supabaseRef.current;
        let isActive = true;

        const refreshFriendsBadgeCount = async () => {
            let taskQuery = supabase
                .from("tasks")
                .select("id", { count: "exact", head: true })
                .eq("voucher_id", userId)
                .neq("user_id", userId)
                .in("status", ["AWAITING_VOUCHER", "MARKED_COMPLETE"]);

            if (friendsBadgeSeenAt) {
                taskQuery = taskQuery.gt("marked_completed_at", friendsBadgeSeenAt);
            }
            let rectificationQuery = supabase.from("rectification_requests" as any)
                .select("id", { count: "exact", head: true })
                .eq("target_voucher_id", userId)
                .eq("target_type", "ORIGINAL_VOUCHER")
                .eq("state", "PENDING_HUMAN");
            if (friendsBadgeSeenAt) rectificationQuery = rectificationQuery.gt("updated_at", friendsBadgeSeenAt);
            const [taskResult, rectificationResult] = await Promise.all([taskQuery, rectificationQuery]);
            if (!isActive || taskResult.error || rectificationResult.error) return;
            setFriendsBadgeCount((taskResult.count ?? 0) + (rectificationResult.count ?? 0));
        };

        void refreshFriendsBadgeCount();

        const channel = supabase
            .channel(`friends-vouch-request-badge:${userId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "tasks",
                    filter: `voucher_id=eq.${userId}`,
                },
                () => {
                    void refreshFriendsBadgeCount();
                }
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "rectification_requests", filter: `target_voucher_id=eq.${userId}` },
                () => { void refreshFriendsBadgeCount(); }
            )
            .subscribe();

        return () => {
            isActive = false;
            void supabase.removeChannel(channel);
        };
    }, [friendsBadgeReady, friendsBadgeSeenAt, userId]);

    const links = useMemo(
        () => [
            { href: "/tasks", label: "Tasks" },
            { href: "/stats", label: "Stats", badge: statsBadgeCount > 0 ? statsBadgeCount : undefined },
            { href: "/friends", label: "Friends", badge: friendsBadgeCount > 0 ? friendsBadgeCount : undefined },
            { href: "/commit", label: "Commit" },
            { href: "/ledger", label: "Ledger" },
            { href: "/settings", label: "Settings", badge: settingsBadgeCount > 0 ? settingsBadgeCount : undefined },
        ],
        [friendsBadgeCount, settingsBadgeCount, statsBadgeCount]
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
                    const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
                    const ariaLabel =
                        link.badge !== undefined
                            ? link.href === "/stats"
                                ? `${link.label}, ${link.badge} proof request${link.badge === 1 ? "" : "s"}`
                                : link.href === "/settings"
                                    ? `${link.label}, ${link.badge} friend request${link.badge === 1 ? "" : "s"}`
                                : `${link.label}, ${link.badge} vouch request${link.badge === 1 ? "" : "s"}`
                            : link.label;
                    const badgeText =
                        link.badge !== undefined
                            ? link.badge > 99
                                ? "99+"
                                : String(link.badge)
                            : null;

                    return (
                        <Link
                            key={`${link.href}-${link.label}`}
                            href={link.href}
                            prefetch
                            className={`flex h-8 w-full min-w-0 items-center justify-center whitespace-nowrap text-[10px] sm:text-xs font-mono uppercase leading-none tracking-[0.08em] sm:tracking-[0.12em] transition-colors ${isActive ? "text-white font-bold" : "text-slate-400 hover:text-white"
                                }`}
                            aria-label={ariaLabel}
                            aria-current={isActive ? "page" : undefined}
                            onMouseEnter={() => prefetchLink(link.href)}
                            onFocus={() => prefetchLink(link.href)}
                            onTouchStart={() => prefetchLink(link.href)}
                            onClick={() => haptics.light()}
                        >
                        <span className="relative inline-flex">
                            {link.href === "/ledger" ? (
                                <>
                                    <span className="sr-only">Ledger</span>
                                    <span
                                        aria-hidden
                                        className="text-emerald-300 text-[20px] leading-none font-semibold normal-case tracking-normal"
                                        style={{ textShadow: "0 0 8px rgba(52, 211, 153, 0.95), 0 0 14px rgba(52, 211, 153, 0.55)" }}
                                    >
                                        {"\u20AC"}
                                    </span>
                                    <span
                                        aria-hidden
                                        className="text-red-300 text-[20px] leading-none font-semibold normal-case tracking-normal"
                                        style={{ textShadow: "0 0 8px rgba(248, 113, 113, 0.95), 0 0 14px rgba(248, 113, 113, 0.55)" }}
                                    >
                                        {"\u20AC"}
                                    </span>
                                </>
                            ) : link.href === "/friends" ? (
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
                            ) : link.href === "/settings" ? (
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
                            {badgeText !== null && (
                                <span className="absolute -right-2 -top-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white ring-2 ring-slate-950">
                                    {badgeText}
                                </span>
                            )}
                        </span>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}
