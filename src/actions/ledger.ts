"use server";

import { createClient } from "@/lib/supabase/server";
import { sendNotification } from "@/lib/notifications";
import { formatCurrencyFromCents, normalizeCurrency } from "@/lib/currency";

export async function getLedgerPeriods(): Promise<string[]> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const currentPeriod = new Date().toISOString().slice(0, 7);

    // @ts-ignore
    const { data } = await supabase
        .from("ledger_entries")
        .select("period")
        .eq("user_id", user.id)
        .neq("period", currentPeriod);

    if (!data) return [];
    const unique = [...new Set((data as any[]).map((r) => r.period as string))];
    return unique.sort((a, b) => b.localeCompare(a));
}

export async function getLedgerEntriesForPeriod(period: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { entries: [], totalCents: 0 };

    // @ts-ignore
    const { data: entries } = await supabase
        .from("ledger_entries")
        .select(`*, task:tasks(*)`)
        .eq("user_id", user.id)
        .eq("period", period)
        .order("created_at", { ascending: false });

    const totalCents = (entries as any[])?.reduce(
        (sum: number, e: any) => sum + e.amount_cents,
        0
    ) ?? 0;

    return { entries: (entries ?? []) as any[], totalCents };
}

function formatLedgerEntryType(entryType: string): string {
    if (entryType === "voucher_timeout_penalty") return "Voucher Timeout Penalty";
    if (entryType === "force_majeure") return "Force Majeure";
    if (entryType === "failure") return "Failure";
    if (entryType === "rectified") return "Rectified";
    return entryType;
}

export async function sendLedgerReportEmail() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user || !user.email) {
        return { error: "Not authenticated or email missing" };
    }
    const { data: profile } = await supabase
        .from("profiles")
        .select("currency")
        .eq("id", user.id)
        .maybeSingle();
    const currency = normalizeCurrency((profile as { currency?: string | null } | null)?.currency);

    const currentPeriod = new Date().toISOString().slice(0, 7);

    // Get ledger entries
    // @ts-ignore
    const { data: entries } = await supabase
        .from("ledger_entries")
        .select(`
          *,
          task:tasks(*)
        `)
        .eq("user_id", user.id)
        .eq("period", currentPeriod)
        .order("created_at", { ascending: false });

    if (!entries || entries.length === 0) {
        return { error: "No ledger entries to report for this month." };
    }

    const totalAmountCents = (entries as any).reduce((sum: number, entry: any) => sum + entry.amount_cents, 0);
    const totalAmount = formatCurrencyFromCents(totalAmountCents, currency);

    const rowsHtml = (entries as any).map((entry: any) => `
        <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${new Date(entry.created_at).toLocaleDateString()}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${entry.task?.title || "Manual Entry"}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${formatLedgerEntryType(entry.entry_type)}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right; color: ${entry.amount_cents > 0 ? '#dc322f' : '#859900'}; font-family: monospace;">
                ${entry.amount_cents > 0 ? '+' : ''}${formatCurrencyFromCents(entry.amount_cents, currency)}
            </td>
        </tr>
    `).join("");

    const html = `
        <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #6366f1;">Ledger Report</h1>
            <p>Here is your current ledger breakdown for ${new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}.</p>
            
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <thead>
                    <tr style="background: #f8fafc; text-align: left;">
                        <th style="padding: 8px; border-bottom: 2px solid #e2e8f0;">Date</th>
                        <th style="padding: 8px; border-bottom: 2px solid #e2e8f0;">Task</th>
                        <th style="padding: 8px; border-bottom: 2px solid #e2e8f0;">Type</th>
                        <th style="padding: 8px; border-bottom: 2px solid #e2e8f0; text-align: right;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="3" style="padding: 16px 8px; text-align: right; font-weight: bold;">Current Total:</td>
                        <td style="padding: 16px 8px; text-align: right; font-weight: bold; font-family: monospace; font-size: 1.2em; color: #db2777;">
                            ${totalAmount}
                        </td>
                    </tr>
                </tfoot>
            </table>
            
            <p style="font-size: 0.9em; color: #666; border-top: 1px solid #eee; padding-top: 20px;">
                This ledger settles at the end of the month. Keep up your streaks!
            </p>
        </div>
    `;

    await sendNotification({
        to: user.email,
        subject: `Your Ledger Report - ${totalAmount} Pending`,
        html,
        text: `Your ledger report for ${currentPeriod}. Total pending: ${totalAmount}.`,
    });

    return { success: true };
}
