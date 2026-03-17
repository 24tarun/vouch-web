"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { getLedgerEntriesForPeriod } from "@/actions/ledger";
import { formatCurrencyFromCents, type SupportedCurrency } from "@/lib/currency";

interface Props {
    periods: string[];
    currency: SupportedCurrency;
}

function formatPeriodLabel(period: string): string {
    const [year, month] = period.split("-");
    const date = new Date(Number(year), Number(month) - 1, 1);
    return date.toLocaleString("default", { month: "long", year: "numeric" });
}

interface MonthData {
    entries: any[];
    totalCents: number;
}

export function PreviousMonthsAccordion({ periods, currency }: Props) {
    const [open, setOpen] = useState<string | null>(null);
    const [cache, setCache] = useState<Record<string, MonthData>>({});
    const [isPending, startTransition] = useTransition();
    const [loadingPeriod, setLoadingPeriod] = useState<string | null>(null);

    function toggle(period: string) {
        if (open === period) {
            setOpen(null);
            return;
        }
        setOpen(period);
        if (!cache[period]) {
            setLoadingPeriod(period);
            startTransition(async () => {
                const data = await getLedgerEntriesForPeriod(period);
                setCache((prev) => ({ ...prev, [period]: data }));
                setLoadingPeriod(null);
            });
        }
    }

    if (periods.length === 0) return null;

    return (
        <section className="space-y-2">
            <div className="border-b border-slate-900 pb-2">
                <h2 className="text-xl font-semibold text-slate-500">Previous Months</h2>
            </div>

            <div className="flex flex-col">
                {periods.map((period) => {
                    const isOpen = open === period;
                    const isLoading = loadingPeriod === period && isPending;
                    const data = cache[period];
                    const label = formatPeriodLabel(period);

                    return (
                        <div key={period} className="border-b border-slate-900 last:border-0">
                            <button
                                onClick={() => toggle(period)}
                                className="w-full flex items-center justify-between py-4 text-left hover:bg-slate-900/10 -mx-4 px-4 transition-colors"
                            >
                                <div className="flex items-center gap-2">
                                    {isOpen
                                        ? <ChevronDown className="h-4 w-4 text-slate-500" />
                                        : <ChevronRight className="h-4 w-4 text-slate-500" />
                                    }
                                    <span className="text-slate-300 font-medium">{label}</span>
                                </div>
                                {data && (
                                    <span className={`text-sm font-mono ${data.totalCents > 0 ? "text-red-500" : data.totalCents < 0 ? "text-green-500" : "text-slate-500"}`}>
                                        {data.totalCents > 0 ? "+" : ""}{formatCurrencyFromCents(data.totalCents, currency)}
                                    </span>
                                )}
                                {isLoading && (
                                    <span className="text-xs text-slate-600 animate-pulse">Loading…</span>
                                )}
                            </button>

                            {isOpen && data && (
                                <div className="flex flex-col pb-2">
                                    {data.entries.length === 0 ? (
                                        <p className="text-slate-600 text-sm italic py-4 px-4">No entries for this period.</p>
                                    ) : (
                                        data.entries.map((entry: any) => {
                                            const taskId = entry.task?.id || entry.task_id || null;
                                            const absAmountLabel = formatCurrencyFromCents(Math.abs(entry.amount_cents), currency);
                                            return (
                                                <div key={entry.id} className="group flex items-center gap-3 py-5 border-b border-slate-900/50 last:border-0 hover:bg-slate-900/10 -mx-4 px-4 transition-colors">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <p className="text-base font-medium text-slate-300 group-hover:text-slate-100 transition-colors truncate">
                                                                {entry.task?.title || "Accountability Adjustment"}
                                                            </p>
                                                            <Badge variant="outline" className={`text-[9px] h-4 py-0 px-1 border-slate-900 uppercase tracking-tighter ${
                                                                entry.entry_type === "failure"
                                                                    ? "text-red-500"
                                                                    : entry.entry_type === "voucher_timeout_penalty"
                                                                        ? "text-orange-400"
                                                                        : entry.entry_type === "force_majeure"
                                                                            ? "text-yellow-500"
                                                                            : "text-green-500"
                                                            }`}>
                                                                {entry.entry_type === "failure"
                                                                    ? "Failure"
                                                                    : entry.entry_type === "voucher_timeout_penalty"
                                                                        ? "Voucher Timeout"
                                                                        : entry.entry_type === "force_majeure"
                                                                            ? "Force Majeure"
                                                                            : "Rectified"}
                                                            </Badge>
                                                            {taskId && (
                                                                <Link
                                                                    href={`/dashboard/tasks/${taskId}`}
                                                                    className="h-7 w-7 p-0 text-slate-300 hover:text-white hover:bg-slate-800 rounded-md transition-colors inline-flex items-center justify-center"
                                                                    aria-label="Open task"
                                                                >
                                                                    <ExternalLink className="h-3.5 w-3.5" />
                                                                </Link>
                                                            )}
                                                        </div>
                                                        <p className="text-xs text-slate-600 mt-1">
                                                            {new Date(entry.created_at).toLocaleDateString()} at {new Date(entry.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                                        </p>
                                                    </div>
                                                    <div className="flex flex-col items-end">
                                                        <span className={`text-lg font-mono ${entry.amount_cents > 0 ? "text-red-500" : "text-green-500"}`}>
                                                            {entry.amount_cents > 0 ? "+" : "-"}{absAmountLabel}
                                                        </span>
                                                        <span className="text-[10px] text-slate-700 uppercase tracking-widest mt-1">
                                                            {entry.amount_cents < 0 ? "Reversal" : "Amount"}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
