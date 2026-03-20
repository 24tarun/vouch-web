import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCommitments } from "@/actions/commitments";
import { normalizeCurrency } from "@/lib/currency";
import { CommitmentsPageClient } from "@/components/CommitmentsPageClient";

export default async function CommitmentsPage() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        redirect("/login");
    }

    const [commitments, profileResult] = await Promise.all([
        getCommitments(),
        supabase
            .from("profiles")
            .select("currency")
            .eq("id", user.id)
            .maybeSingle(),
    ]);

    const currency = normalizeCurrency((profileResult.data as { currency?: unknown } | null)?.currency);

    return <CommitmentsPageClient commitments={commitments} currency={currency} />;
}
