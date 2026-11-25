import { schedules } from "@trigger.dev/sdk/v3";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotification } from "@/lib/notifications";
import { type Database } from "@/lib/types";
import { AI_PROFILE_ID } from "@/lib/ai-voucher/constants";

interface PendingVoucherTask {
    voucher_id: string;
    voucher_response_deadline: string;
    voucher: {
        id: string;
        email: string;
        username: string | null;
    } | null;
}

type VoucherReminderLogInsert = Database["public"]["Tables"]["voucher_reminder_logs"]["Insert"];

export const voucherDeadlineWarning = schedules.task({
    id: "voucher-deadline-warning",
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
            .neq("voucher_id", AI_PROFILE_ID)
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

            const body =
                summary.count === 1
                    ? "You have 1 vouch request."
                    : `You have ${summary.count} vouch requests.`;

            const reminderLogPayload: VoucherReminderLogInsert = {
                voucher_id: voucherId,
                reminder_date: utcDate,
                pending_count: summary.count,
            };

            const { error: reserveError } = await (supabase.from("voucher_reminder_logs") as any)
                .insert(reminderLogPayload as any);
            if (reserveError) {
                const code = (reserveError as { code?: string }).code;
                if (code === "23505") {
                    continue;
                }

                console.error(`Failed to reserve reminder log for voucher ${voucherId}:`, reserveError);
                continue;
            }

            try {
                await sendNotification({
                    userId: voucherId,
                    title: "Vouch Requests",
                    text: body,
                    email: false,
                    push: true,
                    url: "/voucher",
                    tag: `voucher-digest-${voucherId}-${utcDate}`,
                    data: {
                        kind: "VOUCH_REQUEST_DIGEST",
                        pending_count: summary.count,
                        reminder_date: utcDate,
                    },
                });
            } catch (error) {
                console.error(`Failed to send digest reminder for voucher ${voucherId}:`, error);

                const { error: releaseError } = await (supabase.from("voucher_reminder_logs") as any)
                    .delete()
                    .eq("voucher_id", voucherId as any)
                    .eq("reminder_date", utcDate as any);
                if (releaseError) {
                    console.error(`Failed to release reminder-log reservation for voucher ${voucherId}:`, releaseError);
                }
            }
        }
    },
});
