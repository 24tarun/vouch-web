import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";
import { formatCurrencyFromCents, normalizeCurrency } from "@/lib/currency";

interface LedgerSummaryRow {
    amount_cents: number | null;
}

interface LedgerDetailRow {
    amount_cents: number | null;
    entry_type: string | null;
    task: {
        title: string | null;
        status: string | null;
    } | null;
}

interface SelectedCharity {
    id: string;
    key: string;
    name: string;
    is_active: boolean;
}

interface LedgerSummaryProfile {
    currency: string | null;
    charity_enabled: boolean | null;
    selected_charity_id: string | null;
}

export interface LedgerTillDateSummary {
    entryCount: number;
    totalCents: number;
    donationCents: number;
    totalFormatted: string;
    donationFormatted: string;
    currency: "EUR" | "USD" | "INR";
    charityName: string | null;
    charityKey: string | null;
    message: string;
}

export interface LedgerTillDateEmailData {
    summary: LedgerTillDateSummary;
    entries: {
        title: string;
        entryTypeLabel: string;
        amountCents: number;
    }[];
}

async function resolveProfileContext(
    supabase: SupabaseClient<Database>,
    userId: string
): Promise<{
    profile: LedgerSummaryProfile | null;
    activeCharity: SelectedCharity | null;
    error?: string;
}> {
    const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("currency, charity_enabled, selected_charity_id")
        .eq("id", userId)
        .maybeSingle();

    if (profileError) {
        return { profile: null, activeCharity: null, error: profileError.message };
    }

    const profileRow = (profile ?? null) as LedgerSummaryProfile | null;
    let activeCharity: SelectedCharity | null = null;
    if (profileRow?.charity_enabled && profileRow.selected_charity_id) {
        const { data: charity, error: charityError } = await supabase
            .from("charities")
            .select("id, key, name, is_active")
            .eq("id", profileRow.selected_charity_id)
            .maybeSingle();

        if (charityError) {
            return { profile: profileRow, activeCharity: null, error: charityError.message };
        }
        const resolvedCharity = (charity ?? null) as SelectedCharity | null;
        if (resolvedCharity?.is_active) {
            activeCharity = resolvedCharity;
        }
    }

    return { profile: profileRow, activeCharity };
}

function formatLedgerEntryType(entryType: string, taskStatus?: string | null): string {
    if (entryType === "voucher_timeout_penalty") return "Voucher Timeout Penalty";
    if (entryType === "override") return "Override";
    if (entryType === "denied") return "Denied";
    if (entryType === "missed") return "Missed";
    if (entryType === "surrendered") return "Surrendered";
    if (entryType === "rectified") return "Rectified";
    return entryType || "Entry";
}

export async function compileLedgerTillDateSummary(
    supabase: SupabaseClient<Database>,
    userId: string
): Promise<{ data?: LedgerTillDateSummary; error?: string }> {
    const [{ data: entries, error: entriesError }, profileContext] = await Promise.all([
        supabase
            .from("ledger_entries")
            .select("amount_cents")
            .eq("user_id", userId)
            .order("created_at", { ascending: false }),
        resolveProfileContext(supabase, userId),
    ]);

    if (entriesError) {
        return { error: entriesError.message };
    }
    if (profileContext.error) {
        return { error: profileContext.error };
    }

    const ledgerRows = (entries ?? []) as LedgerSummaryRow[];
    const profileRow = profileContext.profile;
    const currency = normalizeCurrency(profileRow?.currency);
    const totalCents = ledgerRows.reduce((sum, row) => sum + Number(row.amount_cents ?? 0), 0);
    const donationCents = Math.max(totalCents, 0);
    const activeCharity = profileContext.activeCharity;
    const totalFormatted = formatCurrencyFromCents(totalCents, currency);
    const donationFormatted = formatCurrencyFromCents(donationCents, currency);

    let message = `You have ${ledgerRows.length} ledger entries till date. Net total is ${totalFormatted}.`;
    if (donationCents <= 0) {
        message = `${message} You do not owe any donation right now.`;
    } else if (activeCharity) {
        message = `${message} As per your charity preference, you should donate ${donationFormatted} to ${activeCharity.name}.`;
    } else {
        message = `${message} You should donate ${donationFormatted}, but your active charity preference is missing. Please select one in Settings.`;
    }

    return {
        data: {
            entryCount: ledgerRows.length,
            totalCents,
            donationCents,
            totalFormatted,
            donationFormatted,
            currency,
            charityName: activeCharity?.name ?? null,
            charityKey: activeCharity?.key ?? null,
            message,
        },
    };
}

export async function compileLedgerTillDateEmailData(
    supabase: SupabaseClient<Database>,
    userId: string
): Promise<{ data?: LedgerTillDateEmailData; error?: string }> {
    const [{ data: entries, error: entriesError }, summaryResult] = await Promise.all([
        supabase
            .from("ledger_entries")
            .select("amount_cents, entry_type, task:tasks(title, status)")
            .eq("user_id", userId)
            .order("created_at", { ascending: false }),
        compileLedgerTillDateSummary(supabase, userId),
    ]);

    if (entriesError) {
        return { error: entriesError.message };
    }
    if (summaryResult.error || !summaryResult.data) {
        return { error: summaryResult.error ?? "Unable to compile ledger summary." };
    }

    const detailed = ((entries ?? []) as LedgerDetailRow[]).map((entry) => {
        const amountCents = Number(entry.amount_cents ?? 0);
        return {
            title: entry.task?.title?.trim() || "Adjustment",
            entryTypeLabel: formatLedgerEntryType(String(entry.entry_type ?? ""), entry.task?.status),
            amountCents,
        };
    });

    return {
        data: {
            summary: summaryResult.data,
            entries: detailed,
        },
    };
}
