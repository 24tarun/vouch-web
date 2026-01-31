import { schedules } from "@trigger.dev/sdk/v3";
import { createAdminClient } from "@/lib/supabase/admin";
import { resend } from "@/lib/resend";

export const monthlySettlement = schedules.task({
    id: "monthly-settlement",
    cron: "0 9 1 * *", // Run at 9am on the 1st of every month
    run: async (payload, { ctx }) => {
        const supabase = createAdminClient();

        // Calculate LAST month's period (YYYY-MM)
        const today = new Date();
        const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const period = lastMonth.toISOString().slice(0, 7);

        console.log(`Running settlement for period: ${period}`);

        // Get all profiles to calculate their totals
        // In a real app, we'd batch this or use a SQL aggregation query
        const { data } = await supabase.from("profiles").select("*") as any;
        const users = data;

        if (!users) return;

        for (const user of users) {
            // Aggregate ledger entries
            const queryResult = await supabase
                .from("ledger_entries")
                .select("amount_cents")
                .eq("user_id", user.id)
                .eq("period", period) as any;

            const entries = queryResult.data;

            const totalCents = (entries as any[])?.reduce((sum, e) => sum + e.amount_cents, 0) || 0;

            if (totalCents > 0) {
                // Send report
                const amountFormatted = (totalCents / 100).toFixed(2);

                if (resend) {
                    try {
                        await resend.emails.send({
                            from: "Vouch <noreply@remails.tarunh.com>",
                            to: user.email,
                            subject: `Monthly Settlement: €${amountFormatted} Donation Due`,
                            html: `
                <h1>Monthly Accountability Report</h1>
                <p>Hi ${user.username},</p>
                <p>For the month of ${period}, your accountability failures totaled:</p>
                <h2>€${amountFormatted}</h2>
                <p>Please proceed to the dashboard to settle your donation.</p>
                <br/>
                <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/ledger">View Ledger</a>
              `,
                        });
                        console.log(`Sent settlement email to ${user.email}`);
                    } catch (e) {
                        console.error(`Failed to send email to ${user.email}`, e);
                    }
                }
            }
        }
    },
});
