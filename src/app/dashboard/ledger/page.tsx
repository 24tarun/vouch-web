import { createClient } from "@/lib/supabase/server";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { LedgerEntry, Task } from "@/lib/types";

export default async function LedgerPage() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    // Get current month
    const currentPeriod = new Date().toISOString().slice(0, 7);

    // Get ledger entries for current month
    const { data: entries } = await supabase
        .from("ledger_entries")
        .select(`
      *,
      task:tasks(*)
    `)
        .eq("user_id", user?.id)
        .eq("period", currentPeriod)
        .order("created_at", { ascending: false });

    // Get rectify passes used this month
    const { count: rectifyCount } = await supabase
        .from("rectify_passes")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user?.id)
        .eq("period", currentPeriod);

    // Get force majeure usage this month
    const { count: forceCount } = await supabase
        .from("force_majeure")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user?.id)
        .eq("period", currentPeriod);

    const totalAmount =
        entries?.reduce(
            (sum, entry: LedgerEntry) => sum + entry.amount_cents,
            0
        ) || 0;

    const failedCount =
        entries?.filter((e: LedgerEntry) => e.entry_type === "failure").length || 0;
    const rectifiedCount =
        entries?.filter((e: LedgerEntry) => e.entry_type === "rectified").length ||
        0;

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-white">Ledger</h1>
                <p className="text-slate-400 mt-1">
                    Track your accountability and projected donations
                </p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="pb-2">
                        <CardDescription className="text-slate-400">
                            Current Period
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-bold text-white">{currentPeriod}</p>
                    </CardContent>
                </Card>

                <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="pb-2">
                        <CardDescription className="text-slate-400">
                            Projected Donation
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-bold text-pink-400">
                            €{(totalAmount / 100).toFixed(2)}
                        </p>
                    </CardContent>
                </Card>

                <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="pb-2">
                        <CardDescription className="text-slate-400">
                            Rectify Passes
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-bold text-orange-400">
                            {rectifyCount || 0} / 5
                        </p>
                    </CardContent>
                </Card>

                <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="pb-2">
                        <CardDescription className="text-slate-400">
                            Force Majeure
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-bold text-yellow-400">
                            {(forceCount || 0) > 0 ? "Used" : "Available"}
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Projection Notice */}
            <Card className="bg-purple-900/30 border-purple-500/50">
                <CardContent className="py-4">
                    <p className="text-purple-300 text-center">
                        💜 If the month ended today, you would donate{" "}
                        <strong>€{(totalAmount / 100).toFixed(2)}</strong> to charity.
                    </p>
                </CardContent>
            </Card>

            {/* Entries */}
            <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                    <CardTitle className="text-white">Ledger Entries</CardTitle>
                    <CardDescription className="text-slate-400">
                        {failedCount} failure(s), {rectifiedCount} rectified
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {(!entries || entries.length === 0) ? (
                        <p className="text-slate-400 text-center py-8">
                            No ledger entries this month. Keep up the good work! 🎉
                        </p>
                    ) : (
                        <div className="space-y-3">
                            {entries.map((entry: LedgerEntry & { task: Task }) => (
                                <div
                                    key={entry.id}
                                    className="flex items-center justify-between p-3 rounded-lg bg-slate-700/30"
                                >
                                    <div className="flex items-center gap-3">
                                        <Badge
                                            className={
                                                entry.entry_type === "failure"
                                                    ? "bg-red-500"
                                                    : "bg-green-500"
                                            }
                                        >
                                            {entry.entry_type === "failure" ? "Failed" : "Rectified"}
                                        </Badge>
                                        <div>
                                            <p className="text-white">
                                                {entry.task?.title || "Unknown Task"}
                                            </p>
                                            <p className="text-xs text-slate-400">
                                                {new Date(entry.created_at).toLocaleDateString()}
                                            </p>
                                        </div>
                                    </div>
                                    <p
                                        className={`font-medium ${entry.amount_cents > 0
                                                ? "text-red-400"
                                                : "text-green-400"
                                            }`}
                                    >
                                        {entry.amount_cents > 0 ? "+" : ""}€
                                        {(entry.amount_cents / 100).toFixed(2)}
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Settlement Notice */}
            <Card className="bg-slate-800/30 border-slate-700/50">
                <CardContent className="py-4">
                    <p className="text-sm text-slate-400 text-center">
                        ℹ️ Ledger settles at the end of each month. Donation flow is coming
                        soon — for now, we&apos;ll remind you of your commitment.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
