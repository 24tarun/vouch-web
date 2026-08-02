/* eslint-disable @typescript-eslint/no-explicit-any */
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteTaskProof } from "@/lib/task-proof";
import { enqueueGoogleCalendarOutbox } from "@/lib/google-calendar/sync";
import { sendNotification } from "@/lib/notifications";
import { notifyCommitmentRevivedIfNeeded } from "@/actions/commitments";

interface DueResolution {
    task_id: string;
    owner_id: string;
    resolution: "AUTO_APPROVED" | "DECLINED";
}

export async function processDueRectifications(ownerId?: string): Promise<DueResolution[]> {
    const admin = createAdminClient();
    const { data, error } = await (admin.rpc("process_due_rectification_requests" as any, {
        p_before: new Date().toISOString(),
        p_owner_id: ownerId ?? null,
    } as any) as any);
    if (error) throw new Error(`Rectification preflight failed: ${error.message}`);
    const resolutions = ((data || []) as DueResolution[]);
    await Promise.all(resolutions.map(async (resolution) => {
        const { data: taskData } = await (admin.from("tasks") as any)
            .select("id, title, user_id, recurrence_rule_id")
            .eq("id", resolution.task_id)
            .maybeSingle();
        if (!taskData) return;
        await Promise.allSettled([
            deleteTaskProof(resolution.task_id, `rectification_${resolution.resolution.toLowerCase()}`),
            enqueueGoogleCalendarOutbox(resolution.owner_id, resolution.task_id, "UPSERT"),
            resolution.resolution === "AUTO_APPROVED"
                ? notifyCommitmentRevivedIfNeeded(resolution.task_id, taskData.recurrence_rule_id ?? null)
                : Promise.resolve(),
            sendNotification({
                userId: resolution.owner_id,
                title: resolution.resolution === "AUTO_APPROVED" ? "Task auto-rectified" : "Rectification expired",
                text: resolution.resolution === "AUTO_APPROVED"
                    ? `“${taskData.title}” was rectified because no human decision arrived before the deadline.`
                    : `The rectification request for “${taskData.title}” expired without an approval.`,
                url: `/tasks/${resolution.task_id}`,
                tag: `rectification-${resolution.task_id}-${resolution.resolution.toLowerCase()}`,
                data: { kind: `RECTIFICATION_${resolution.resolution}`, taskId: resolution.task_id },
                email: false,
            }),
        ]);
    }));
    return resolutions;
}
