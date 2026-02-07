import { schedules } from "@trigger.dev/sdk/v3";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotification } from "@/lib/notifications";

interface PendingVoucherTask {
    voucher_id: string;
    voucher_response_deadline: string;
    voucher: {
        id: string;
        email: string;
        username: string | null;
    } | null;
}

export const voucherDeadlineWarning = schedules.task({
    id: "voucher-deadline-warning",
    // 09:00, 12:00, 15:00, 18:00, 21:00 UTC
    cron: "0 9,12,15,18,21 * * *",
    run: async () => {
        const supabase = createAdminClient();
        const now = new Date();
        const nowIso = now.toISOString();
        const utcDate = nowIso.slice(0, 10);

        const response = await supabase
            .from("tasks")
            .select(`
                voucher_id,
                voucher_response_deadline,
                voucher:profiles!tasks_voucher_id_fkey(id, email, username)
            `)
            .eq("status", "AWAITING_VOUCHER")
            .gt("voucher_response_deadline", nowIso);

        if (response.error) {
            console.error("Error fetching tasks for voucher digest reminder:", response.error);
            return;
        }

        const rows = (response.data || []) as unknown as PendingVoucherTask[];

        const countsByVoucher = new Map<
            string,
            { count: number; email?: string; username?: string | null }
        >();

        for (const task of rows) {
            const voucherId = task.voucher?.id || task.voucher_id;
            if (!voucherId) continue;

            const existing = countsByVoucher.get(voucherId);
            if (existing) {
                existing.count += 1;
                continue;
            }

            countsByVoucher.set(voucherId, {
                count: 1,
                email: task.voucher?.email,
                username: task.voucher?.username,
            });
        }

        console.log(`Found ${countsByVoucher.size} vouchers with pending requests`);

        for (const [voucherId, summary] of countsByVoucher.entries()) {
            if (summary.count <= 0) continue;

            const existingLog = await supabase
                .from("voucher_reminder_logs")
                .select("id")
                .eq("voucher_id", voucherId)
                .eq("reminder_date", utcDate)
                .maybeSingle();

            if (existingLog.error) {
                console.error(`Failed to check reminder log for voucher ${voucherId}:`, existingLog.error);
                continue;
            }

            if (existingLog.data) {
                continue;
            }

            const body =
                summary.count === 1
                    ? "You have 1 vouch request."
                    : `You have ${summary.count} vouch requests.`;

            try {
                await sendNotification({
                    to: summary.email,
                    userId: voucherId,
                    subject: "Vouch Requests",
                    title: "Vouch Requests",
                    text: body,
                    html: `
                        <h1>Vouch Requests</h1>
                        <p>Hi ${summary.username || "there"},</p>
                        <p>${body}</p>
                        <p><a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/voucher">Open voucher dashboard</a></p>
                    `,
                    url: "/dashboard/voucher",
                    tag: `voucher-digest-${voucherId}-${utcDate}`,
                    data: {
                        kind: "VOUCH_REQUEST_DIGEST",
                        pending_count: summary.count,
                        reminder_date: utcDate,
                    },
                });

                const reminderLogRes = await (supabase
                    .from("voucher_reminder_logs") as any)
                    .upsert(
                        {
                            voucher_id: voucherId,
                            reminder_date: utcDate,
                            pending_count: summary.count,
                        },
                        { onConflict: "voucher_id,reminder_date" }
                    );

                if (reminderLogRes.error) {
                    console.error(`Failed to insert reminder log for voucher ${voucherId}:`, reminderLogRes.error);
                }
            } catch (error) {
                console.error(`Failed to send digest reminder for voucher ${voucherId}:`, error);
            }
        }
    },
});

