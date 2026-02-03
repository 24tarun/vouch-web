import { schedules } from "@trigger.dev/sdk/v3";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotification } from "@/lib/notifications";

export const monthlySettlement = schedules.task({
    id: "monthly-settlement",
    cron: "0 9 1 * *", // Run at 9am on the 1st of every month
    run: async (payload, { ctx }) => {
        const supabase = createAdminClient();

        // Calculate LAST month's period (YYYY-MM)
        const today = new Date();
        const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const period = lastMonth.toISOString().slice(0, 7);
        const monthName = lastMonth.toLocaleString('default', { month: 'long', year: 'numeric' });

        console.log(`Running settlement for period: ${period}`);

        // Get all profiles to calculate their totals
        const { data: users } = await supabase.from("profiles").select("*") as any;

        if (!users) return;

        for (const user of users) {
            // Aggregate ledger entries for the period
            const { data: entries } = await supabase
                .from("ledger_entries")
                .select("*, task:tasks(*)")
                .eq("user_id", user.id)
                .eq("period", period) as any;

            const totalCents = (entries as any[])?.reduce((sum, e) => sum + e.amount_cents, 0) || 0;

            if (totalCents > 0) {
                const amountFormatted = (totalCents / 100).toFixed(2);

                const tableRows = (entries as any[] || []).map(entry => `
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;">${entry.task?.title || 'Adjustment'}</td>
                        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right; color: ${entry.amount_cents > 0 ? '#dc322f' : '#859900'}; font-family: monospace;">
                            ${entry.amount_cents > 0 ? '+' : ''}${(entry.amount_cents / 100).toFixed(2)} EUR
                        </td>
                    </tr>
                `).join('');

                await sendNotification({
                    to: user.email,
                    userId: user.id,
                    subject: `Monthly Settlement: €${amountFormatted} for ${monthName}`,
                    title: "Monthly Settlement",
                    html: `
                        <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);">
                            <h1 style="color: #6366f1; margin-bottom: 8px; font-size: 24px;">Monthly Settlement</h1>
                            <p style="color: #64748b; margin-top: 0; font-size: 16px;">The month of <strong>${monthName}</strong> has concluded.</p>
                            
                            <div style="background: #fff1f2; border: 1px solid #fecdd3; padding: 20px; border-radius: 8px; margin: 24px 0; text-align: center;">
                                <p style="margin: 0; font-size: 14px; color: #9f1239; text-transform: uppercase; font-weight: bold; letter-spacing: 0.05em;">Total Charitable Commitment</p>
                                <p style="margin: 8px 0 0 0; font-size: 42px; font-weight: 800; color: #e11d48;">€${amountFormatted} EUR</p>
                            </div>

                            <h3 style="margin-top: 32px; font-size: 18px; color: #1e293b; border-bottom: 2px solid #f1f5f9; padding-bottom: 8px;">Detailed Breakdown</h3>
                            <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
                                ${tableRows}
                            </table>

                            <div style="margin-top: 40px; background: #f8fafc; padding: 24px; border-radius: 8px; text-align: center;">
                                <p style="margin: 0 0 16px 0; font-size: 14px; color: #475569;">Please proceed to settle your commitment to charity.</p>
                                <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/ledger" style="display: inline-block; background: #6366f1; color: white; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">Settle My Ledger</a>
                            </div>
                            
                            <p style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 40px;">
                                This is an automated settlement notice sent on the 1st of every month.
                            </p>
                        </div>
                    `,
                });
            } else if (entries && entries.length > 0) {
                // Sent congratulatory email for 0 balance but activity
                await sendNotification({
                    to: user.email,
                    userId: user.id,
                    subject: `Monthly Ledger Settled: Perfect Month!`,
                    title: "Monthly Settlement",
                    html: `
                        <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px; text-align: center;">
                            <div style="font-size: 48px; margin-bottom: 16px;">🏆</div>
                            <h1 style="color: #6366f1; margin: 0; font-size: 24px;">Perfect Month!</h1>
                            <p style="color: #64748b; margin-top: 12px; font-size: 16px;">Congratulations, ${user.username}. You successfully completed all your tasks for <strong>${monthName}</strong>.</p>
                            
                            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 24px; border-radius: 8px; margin: 24px 0;">
                                <p style="margin: 0; font-size: 14px; color: #166534; text-transform: uppercase; font-weight: bold;">Final Balance</p>
                                <p style="margin: 8px 0 0 0; font-size: 36px; font-weight: 800; color: #15803d;">€0.00 EUR</p>
                            </div>

                            <p style="color: #64748b; font-size: 14px;">Your commitment to consistency is paying off. Let's keep the momentum going!</p>
                            
                            <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" style="display: inline-block; margin-top: 24px; background: #6366f1; color: white; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold;">New Month, New Goals</a>
                        </div>
                    `,
                });
            }
        }
    },
});
