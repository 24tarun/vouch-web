"use client";

import Link from "next/link";
import { CommitmentSegmentBar } from "@/components/CommitmentSegmentBar";
import { formatCurrencyFromCents, type SupportedCurrency } from "@/lib/currency";
import type { CommitmentListItem } from "@/actions/commitments";

interface CommitmentCardProps {
    commitment: CommitmentListItem;
    currency: SupportedCurrency;
}

function statusStyle(status: string): { className: string; glow: string } {
    if (status === "ACTIVE")
        return { className: "text-cyan-400", glow: "0 0 6px rgba(34,211,238,0.5)" };
    if (status === "COMPLETED")
        return { className: "text-emerald-400", glow: "0 0 6px rgba(52,211,153,0.5)" };
    if (status === "FAILED")
        return { className: "text-red-400", glow: "0 0 6px rgba(248,113,113,0.5)" };
    return { className: "text-slate-500", glow: "none" };
}

export function CommitmentCard({ commitment, currency }: CommitmentCardProps) {
    const status = commitment.derived_status || commitment.status;
    const { className: statusClass, glow: statusGlow } = statusStyle(status);

    const earnedLabel = formatCurrencyFromCents(commitment.earned_so_far_cents, currency);
    const goalLabel = formatCurrencyFromCents(commitment.total_target_cents, currency);

    return (
        <Link
            href={`/dashboard/commitments/${commitment.id}`}
            className="group block border-b border-slate-900 py-6 -mx-4 px-4 transition-colors hover:bg-slate-900/10 last:border-0"
        >
            <div className="flex items-start justify-between gap-3">
                <p className="truncate text-[1.7rem] font-semibold leading-none text-white group-hover:text-blue-400 transition-colors">
                    {commitment.name}
                </p>
                <span
                    className={`shrink-0 font-mono text-[10px] font-bold uppercase tracking-widest ${statusClass}`}
                    style={{ textShadow: statusGlow }}
                >
                    {status}
                </span>
            </div>

            <CommitmentSegmentBar
                className="mt-4"
                startDate={commitment.start_date}
                endDate={commitment.end_date}
                dayStatuses={commitment.day_statuses}
            />

            <div className="mt-4 flex items-end justify-between">
                <div className="space-y-0.5">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Accomplished</p>
                    <p className="text-4xl font-light text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.6)]">{earnedLabel}</p>
                </div>
                <div className="space-y-0.5 text-right">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Goal</p>
                    <p className="text-4xl font-light text-red-400 drop-shadow-[0_0_8px_rgba(248,113,113,0.6)]">{goalLabel}</p>
                </div>
            </div>
        </Link>
    );
}
