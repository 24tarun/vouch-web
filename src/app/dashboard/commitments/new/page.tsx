import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { normalizeCurrency } from "@/lib/currency";
import { CommitmentCreatorClient } from "@/components/CommitmentCreatorClient";

export default async function NewCommitmentPage() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        redirect("/login");
    }

    const [profileResult, tasksResult, recurrenceRulesResult] = await Promise.all([
        supabase
            .from("profiles")
            .select("currency")
            .eq("id", user.id)
            .maybeSingle(),
        supabase
            .from("tasks")
            .select("id, title, deadline, failure_cost_cents")
            .eq("user_id", user.id)
            .in("status", ["CREATED", "POSTPONED"])
            .is("recurrence_rule_id", null)
            .order("deadline", { ascending: true }),
        supabase
            .from("recurrence_rules")
            .select("id, title, failure_cost_cents, rule_config, created_at, last_generated_date")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false }),
    ]);

    const profile = (profileResult.data as { currency?: unknown } | null) || null;
    const currency = normalizeCurrency(profile?.currency);

    const tasks =
        (tasksResult.data as Array<{ id: string; title: string; deadline: string; failure_cost_cents: number }> | null) || [];
    const recurrenceRules =
        (recurrenceRulesResult.data as Array<{
            id: string;
            title: string;
            failure_cost_cents: number;
            rule_config: {
                frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | "WEEKDAYS" | "CUSTOM";
                interval: number;
                days_of_week?: number[];
                time_of_day: string;
            };
            created_at: string;
            last_generated_date: string | null;
        }> | null) || [];

    return (
        <CommitmentCreatorClient
            currency={currency}
            tasks={tasks}
            recurrenceRules={recurrenceRules}
        />
    );
}
