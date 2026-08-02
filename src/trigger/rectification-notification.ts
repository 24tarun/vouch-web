/* eslint-disable @typescript-eslint/no-explicit-any */
import { task } from "@trigger.dev/sdk/v3";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotification } from "@/lib/notifications";

type RectificationNotificationKind =
    | "REQUESTED"
    | "UPDATED"
    | "CANCELLED"
    | "PROOF_REQUESTED"
    | "PROOF_UPLOADED"
    | "ESCALATED"
    | "APPROVED"
    | "DECLINED"
    | "DIRECT_APPROVED";

export const rectificationNotification = task({
    id: "rectification-notification",
    run: async (payload: { taskId: string; requestId?: string; kind: RectificationNotificationKind }) => {
        const admin = createAdminClient();
        const { data: taskData } = await (admin.from("tasks") as any)
            .select("id, title, user_id, voucher_id, user:profiles!tasks_user_id_fkey(username)")
            .eq("id", payload.taskId)
            .maybeSingle();
        if (!taskData) return { skipped: true, reason: "task_missing" };

        const taskRow = taskData as any;
        const ownerProfile = Array.isArray(taskRow.user) ? taskRow.user[0] : taskRow.user;
        let request: any = null;
        if (payload.requestId) {
            const { data } = await (admin.from("rectification_requests") as any)
                .select("*")
                .eq("id", payload.requestId)
                .maybeSingle();
            request = data;
            if (!request || request.task_id !== payload.taskId) return { skipped: true, reason: "request_missing" };
        }

        const toOwner = ["PROOF_REQUESTED", "APPROVED", "DECLINED", "DIRECT_APPROVED"].includes(payload.kind);
        if (!toOwner && request?.target_type !== "ORIGINAL_VOUCHER") {
            return { skipped: true, reason: "no_human_target" };
        }
        const recipientId = toOwner ? taskRow.user_id : request?.target_voucher_id;
        if (!recipientId || recipientId === request?.owner_id) return { skipped: true, reason: "no_recipient" };

        const ownerName = ownerProfile?.username || "A friend";
        const messages: Record<RectificationNotificationKind, { title: string; text: string }> = {
            REQUESTED: { title: "Rectification requested", text: `${ownerName} asked you to rectify “${taskRow.title}”.` },
            UPDATED: { title: "Rectification updated", text: `${ownerName} updated the reason or proof for “${taskRow.title}”.` },
            CANCELLED: { title: "Rectification cancelled", text: `${ownerName} cancelled the rectification request for “${taskRow.title}”.` },
            PROOF_REQUESTED: { title: "Proof requested", text: `Your voucher asked for proof for “${taskRow.title}”. The deadline is unchanged.` },
            PROOF_UPLOADED: { title: "Rectification proof added", text: `${ownerName} added or replaced proof for “${taskRow.title}”.` },
            ESCALATED: { title: "Rectification requested", text: `${ownerName} escalated an AI rectification review to you for “${taskRow.title}”.` },
            APPROVED: { title: "Task rectified", text: `Your voucher rectified “${taskRow.title}”.` },
            DECLINED: { title: "Rectification declined", text: `Your voucher declined rectification for “${taskRow.title}”.` },
            DIRECT_APPROVED: { title: "Task rectified", text: `Your voucher rectified “${taskRow.title}”.` },
        };
        const message = messages[payload.kind];
        await sendNotification({
            userId: recipientId,
            title: message.title,
            text: message.text,
            url: `/tasks/${payload.taskId}`,
            tag: `rectification-${payload.requestId || payload.taskId}-${payload.kind.toLowerCase()}`,
            data: {
                kind: `RECTIFICATION_${payload.kind}`,
                taskId: payload.taskId,
                requestId: payload.requestId,
            },
            email: false,
        });
        return { success: true };
    },
});
