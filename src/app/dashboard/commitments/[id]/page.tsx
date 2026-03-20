import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCommitmentDetail } from "@/actions/commitments";
import { normalizeCurrency } from "@/lib/currency";
import { CommitmentDetailClient } from "@/components/CommitmentDetailClient";

interface CommitmentDetailPageProps {
    params: Promise<{ id: string }>;
}

export default async function CommitmentDetailPage({ params }: CommitmentDetailPageProps) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        redirect("/login");
    }

    const { id } = await params;

    const [detail, profileResult] = await Promise.all([
        getCommitmentDetail(id),
        supabase
            .from("profiles")
            .select("currency")
            .eq("id", user.id)
            .maybeSingle(),
    ]);

    if (!detail) {
        notFound();
    }

    const currency = normalizeCurrency((profileResult.data as { currency?: unknown } | null)?.currency);

    return <CommitmentDetailClient detail={detail} currency={currency} />;
}
