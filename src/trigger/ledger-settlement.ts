/**
 * Trigger: monthly-settlement
 * Runs: every 15 minutes.
 * What it does when it runs:
 * 1) Loads users and checks whether each user is at local day 3 / local hour 00.
 * 2) Computes the previous month period in that user's saved profile timezone.
 * 3) Loads that user's monthly ledger entries and composes settlement email content.
 * 4) Claims idempotency row (`monthly_settlement_runs`) before sending.
 */
import { schedules } from "@trigger.dev/sdk/v3";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotification } from "@/lib/notifications";
import { formatCurrencyFromCents, normalizeCurrency } from "@/lib/currency";

interface SettlementCharity {
    key: string;
    name: string;
    is_active: boolean;
}

interface SettlementUser {
    id: string;
    email: string | null;
    username: string | null;
    currency: string | null;
    timezone: string | null;
    charity_enabled: boolean | null;
    selected_charity: SettlementCharity | null;
}

interface SettlementEntry {
    amount_cents: number;
    entry_type: string;
    task: {
        title: string | null;
    } | null;
}

function isValidTimeZone(timeZone: string): boolean {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
        return true;
    } catch {
        return false;
    }
}

export function resolveTimeZone(rawTimeZone: string | null): string {
    if (typeof rawTimeZone === "string" && rawTimeZone.length > 0 && isValidTimeZone(rawTimeZone)) {
        return rawTimeZone;
    }
    return "UTC";
}

export function getLocalDateParts(date: Date, timeZone: string): {
    year: number;
    month: number;
    day: number;
    hour: number;
} {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hour12: false,
    }).formatToParts(date);

    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
    return {
        year: get("year"),
        month: get("month"),
        day: get("day"),
        hour: get("hour"),
    };
}

export function getPreviousLocalMonthPeriod(date: Date, timeZone: string): {
    period: string;
    monthName: string;
} {
    const local = getLocalDateParts(date, timeZone);
    const previousMonth = local.month === 1 ? 12 : local.month - 1;
    const previousYear = local.month === 1 ? local.year - 1 : local.year;
    const period = `${previousYear}-${String(previousMonth).padStart(2, "0")}`;
    const localMonthDate = new Date(Date.UTC(previousYear, previousMonth - 1, 15, 12, 0, 0));
    const monthName = new Intl.DateTimeFormat("en-US", {
        timeZone,
        month: "long",
        year: "numeric",
    }).format(localMonthDate);
    return { period, monthName };
}

export function shouldCompileNow(date: Date, timeZone: string): boolean {
    const local = getLocalDateParts(date, timeZone);
    return local.day === 3 && local.hour === 0;
}

function formatLedgerEntryType(entryType: string): string {
    if (entryType === "voucher_timeout_penalty") return "Voucher Timeout Penalty";
    if (entryType === "override") return "Override";
    if (entryType === "failure") return "Failure";
    if (entryType === "rectified") return "Rectified";
    return entryType;
}

export const monthlySettlement = schedules.task({
    id: "monthly-settlement",
    cron: "*/15 * * * *",
    run: async () => {
        const supabase = createAdminClient();
        const now = new Date();

        const { data: usersData, error: usersError } = await (supabase.from("profiles") as any)
            .select(`
                id,
                email,
                username,
                currency,
                timezone,
                charity_enabled,
                selected_charity:charities!profiles_selected_charity_id_fkey(key, name, is_active)
            `);
        if (usersError) {
            console.error("Failed to load profiles for monthly settlement:", usersError);
            return;
        }

        const users = (usersData ?? []) as SettlementUser[];
        if (users.length === 0) return;

        for (const user of users) {
            if (!user.email) continue;

            const timeZone = resolveTimeZone(user.timezone);
            if (!shouldCompileNow(now, timeZone)) continue;

            const { period, monthName } = getPreviousLocalMonthPeriod(now, timeZone);
            const { data: entriesData, error: entriesError } = await (supabase.from("ledger_entries") as any)
                .select("amount_cents, entry_type, task:tasks(title)")
                .eq("user_id", user.id as any)
                .eq("period", period as any);

            if (entriesError) {
                console.error(`Failed to load ledger entries for ${user.id} / ${period}:`, entriesError);
                continue;
            }

            const entries = (entriesData ?? []) as SettlementEntry[];
            if (entries.length === 0) continue;

            const totalCents = entries.reduce((sum, entry) => sum + entry.amount_cents, 0);
            const charity = user.charity_enabled && user.selected_charity?.is_active
                ? user.selected_charity
                : null;

            const { error: claimError } = await (supabase.from("monthly_settlement_runs") as any)
                .insert({
                    user_id: user.id,
                    period,
                    timezone: timeZone,
                    total_cents: totalCents,
                    charity_key: charity?.key ?? null,
                } as any);

            if (claimError) {
                if ((claimError as { code?: string }).code === "23505") {
                    continue;
                }
                console.error(`Failed to claim settlement run for ${user.id} / ${period}:`, claimError);
                continue;
            }

            const currency = normalizeCurrency(user.currency);
            const amountFormatted = formatCurrencyFromCents(totalCents, currency);
            const rowsHtml = entries.map((entry) => `
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${entry.task?.title || "Adjustment"}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${formatLedgerEntryType(entry.entry_type)}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right; color: ${entry.amount_cents > 0 ? "#dc322f" : "#859900"}; font-family: monospace;">
                        ${entry.amount_cents > 0 ? "+" : ""}${formatCurrencyFromCents(entry.amount_cents, currency)}
                    </td>
                </tr>
            `).join("");

            if (totalCents > 0) {
                await sendNotification({
                    to: user.email || undefined,
                    userId: user.id,
                    subject: `Monthly Settlement: ${amountFormatted} for ${monthName}`,
                    title: "Monthly Settlement",
                    html: `
                        <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px;">
                            <h1 style="color: #6366f1; margin-bottom: 8px; font-size: 24px;">Monthly Settlement</h1>
                            <p style="color: #64748b; margin-top: 0; font-size: 16px;">The month of <strong>${monthName}</strong> has concluded.</p>

                            <div style="background: #fff1f2; border: 1px solid #fecdd3; padding: 20px; border-radius: 8px; margin: 24px 0; text-align: center;">
                                <p style="margin: 0; font-size: 14px; color: #9f1239; text-transform: uppercase; font-weight: bold; letter-spacing: 0.05em;">Total Charitable Commitment</p>
                                <p style="margin: 8px 0 0 0; font-size: 42px; font-weight: 800; color: #e11d48;">${amountFormatted}</p>
                            </div>

                            <h3 style="margin-top: 32px; font-size: 18px; color: #1e293b; border-bottom: 2px solid #f1f5f9; padding-bottom: 8px;">Detailed Breakdown</h3>
                            <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
                                <thead>
                                    <tr style="background: #f8fafc; text-align: left;">
                                        <th style="padding: 8px; border-bottom: 2px solid #e2e8f0;">Task</th>
                                        <th style="padding: 8px; border-bottom: 2px solid #e2e8f0;">Type</th>
                                        <th style="padding: 8px; border-bottom: 2px solid #e2e8f0; text-align: right;">Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                ${rowsHtml}
                                </tbody>
                            </table>

                            ${charity ? `<p style="margin: 24px 0 8px 0; font-size: 15px; color: #1e293b;">Please send this amount manually to <strong>${charity.name}</strong>.</p>` : ""}
                            <p style="margin: 0; font-size: 14px; color: #475569;">Payment is not processed in-app.</p>

                            <p style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 40px;">
                                This is an automated settlement notice generated on the 3rd in your selected timezone.
                            </p>
                        </div>
                    `,
                });
            } else {
                await sendNotification({
                    to: user.email || undefined,
                    userId: user.id,
                    subject: "Monthly Ledger Settled: Perfect Month!",
                    title: "Monthly Settlement",
                    html: `
                        <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px; text-align: center;">
                            <div style="font-size: 48px; margin-bottom: 16px;">&#127942;</div>
                            <h1 style="color: #6366f1; margin: 0; font-size: 24px;">Perfect Month!</h1>
                            <p style="color: #64748b; margin-top: 12px; font-size: 16px;">Congratulations, ${user.username}. You successfully completed all your tasks for <strong>${monthName}</strong>.</p>

                            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 24px; border-radius: 8px; margin: 24px 0;">
                                <p style="margin: 0; font-size: 14px; color: #166534; text-transform: uppercase; font-weight: bold;">Final Balance</p>
                                <p style="margin: 8px 0 0 0; font-size: 36px; font-weight: 800; color: #15803d;">${formatCurrencyFromCents(0, currency)}</p>
                            </div>

                            ${charity ? `<p style="margin: 0 0 8px 0; color: #475569; font-size: 14px;">Your selected charity is <strong>${charity.name}</strong>.</p>` : ""}
                            <p style="margin: 0; color: #475569; font-size: 14px;">Payment is not processed in-app.</p>
                        </div>
                    `,
                });
            }

            await (supabase.from("monthly_settlement_runs") as any)
                .update({
                    sent_at: new Date().toISOString(),
                    email_sent: true,
                } as any)
                .eq("user_id", user.id as any)
                .eq("period", period as any);
        }
    },
});
