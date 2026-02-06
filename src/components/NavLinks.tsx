'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavLinksProps {
    vouchCount?: number;
}

export function NavLinks({ vouchCount = 0 }: NavLinksProps) {
    const pathname = usePathname();

    const links = [
        { href: "/dashboard", label: "Tasks" },
        { href: "/dashboard/stats", label: "Stats" },
        { href: "/dashboard/voucher", label: "Vouching", badge: vouchCount > 0 ? vouchCount : undefined },
        { href: "/dashboard/friends", label: "Network" },
        { href: "/dashboard/ledger", label: "Ledger" },
    ];

    return (
        <div className="flex items-center gap-6 overflow-x-auto pb-3 -mx-4 px-4 scrollbar-hide no-scrollbar">
            {links.map((link) => {
                const isActive = pathname === link.href || (link.href !== "/dashboard" && pathname.startsWith(link.href));
                return (
                    <Link
                        key={link.href}
                        href={link.href}
                        className={`text-[10px] sm:text-xs font-mono uppercase tracking-widest transition-colors shrink-0 flex items-center gap-1.5 ${isActive ? "text-white font-bold" : "text-slate-400 hover:text-white"
                            }`}
                    >
                        {link.label}
                        {link.badge !== undefined && (
                            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white ring-2 ring-slate-950">
                                {link.badge}
                            </span>
                        )}
                    </Link>
                );
            })}
        </div>
    );
}
