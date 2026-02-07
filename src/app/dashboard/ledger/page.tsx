import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import type { LedgerEntry } from "@/lib/types";
import { LedgerReportButton } from "@/components/LedgerReportButton";

export default async function LedgerPage() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    const currentPeriod = new Date().toISOString().slice(0, 7);

    // @ts-ignore
    const { data: entries } = await supabase
        .from("ledger_entries")
        .select(`
          *,
          task:tasks(*)
        `)
        .eq("user_id", user?.id as any)
        .eq("period", currentPeriod)
        .order("created_at", { ascending: false });

    // @ts-ignore
    const { count: rectifyCount } = await supabase
        .from("rectify_passes")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user?.id as any)
        .eq("period", currentPeriod);

    // @ts-ignore
    const { count: forceCount } = await supabase
        .from("force_majeure")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user?.id as any)
        .eq("period", currentPeriod);

    const totalAmount =
        (entries as any)?.reduce(
            (sum: number, entry: any) => sum + entry.amount_cents,
            0
        ) || 0;

    const failedCount =
        entries?.filter((e: LedgerEntry) => e.entry_type === "failure").length || 0;

    const now = new Date();
    const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const settleDateStr = `${nextMonthDate.getDate().toString().padStart(2, '0')}/${(nextMonthDate.getMonth() + 1).toString().padStart(2, '0')}/${nextMonthDate.getFullYear().toString().slice(-2)}`;

    return (
        <div className="max-w-4xl mx-auto space-y-12 pb-20 mt-12 px-4 md:px-0">
            <div>
                <h1 className="text-3xl font-bold text-white">Ledger</h1>
                <p className="text-slate-400 mt-1">
                    Track your accountability and commitment to change.
                </p>
            </div>

            {/* High-Contrast Summary Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Projected Donation</p>
                    <p className="text-4xl font-light text-pink-500">€{(totalAmount / 100).toFixed(2)}</p>
                </div>
                <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Rectify Passes</p>
                    <p className="text-4xl font-light text-orange-400">{rectifyCount || 0}/5</p>
                </div>
                <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Force Majeure</p>
                    <p className={`text-4xl font-light ${(forceCount || 0) > 0 ? "text-yellow-500" : "text-slate-200"}`}>
                        {(forceCount || 0) > 0 ? "1/1" : "0/1"}
                    </p>
                </div>
                <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Failures</p>
                    <p className="text-4xl font-light text-red-500">{failedCount}</p>
                </div>
            </div>

            {/* Donation Message */}
            <div className="bg-purple-900/10 border border-purple-500/20 rounded-xl p-6 text-center">
                <p className="text-purple-300/80 text-sm">
                    💜 Current charitable commitment for <span className="text-purple-200 font-bold">{new Date().toLocaleString('default', { month: 'long' })}</span>: <span className="text-white">€{(totalAmount / 100).toFixed(2)}</span>
                </p>
            </div>

            {/* Ledger List */}
            <section className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                    <h2 className="text-xl font-semibold text-slate-500">
                        Monthly Activity
                    </h2>
                    <LedgerReportButton />
                </div>
                {(!(entries as any) || (entries as any).length === 0) ? (
                    <div className="bg-slate-900/40 border border-slate-800/20 rounded-xl py-12 text-center">
                        <p className="text-slate-600 text-sm italic">No entries for this period yet.</p>
                    </div>
                ) : (
                    <div className="flex flex-col border-t border-slate-900/50">
                        {(entries as any).map((entry: any) => (
                            <div key={entry.id} className="group flex items-center gap-3 py-6 border-b border-slate-900 last:border-0 hover:bg-slate-900/10 -mx-4 px-4 transition-colors">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <p className="text-lg font-medium text-slate-300 group-hover:text-slate-100 transition-colors truncate">
                                            {entry.task?.title || "Accountability Adjustment"}
                                        </p>
                                        <Badge variant="outline" className={`text-[9px] h-4 py-0 px-1 border-slate-900 uppercase tracking-tighter ${entry.entry_type === "failure"
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
                                                    ? "Voucher Timeout Penalty"
                                                    : entry.entry_type === "force_majeure"
                                                        ? "Force Majeure"
                                                        : "Rectified"}
                                        </Badge>
                                    </div>
                                    <p className="text-xs text-slate-600 mt-1">
                                        {new Date(entry.created_at).toLocaleDateString()} at {new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                </div>

                                <div className="flex flex-col items-end">
                                    <span className={`text-xl font-mono ${entry.amount_cents > 0 ? "text-red-500" : "text-green-500"}`}>
                                        {entry.amount_cents > 0 ? "+" : "-"}€{(Math.abs(entry.amount_cents) / 100).toFixed(2)}
                                    </span>
                                    <span className="text-[10px] text-slate-700 uppercase tracking-widest mt-1">
                                        {entry.amount_cents < 0 ? "Reversal" : "Amount"}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <p className="text-[10px] text-slate-700 text-center uppercase tracking-[0.2em] pt-8">
                settles at the {settleDateStr} • Automatic donation flow coming soon
            </p>
        </div>
    );
}
