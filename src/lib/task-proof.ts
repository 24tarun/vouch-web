import { createAdminClient } from "@/lib/supabase/admin";
export * from "@/lib/task-proof-shared";
import { TASK_PROOFS_BUCKET } from "@/lib/task-proof-shared";

export async function deleteTaskProof(taskId: string, reason: string): Promise<{
    success: boolean;
    deleted: boolean;
    error?: string;
}> {
    const supabaseAdmin = createAdminClient();

    const { data: proof, error: proofError } = await (supabaseAdmin.from("task_completion_proofs") as any)
        .select("id, bucket, object_path")
        .eq("task_id", taskId as any)
        .maybeSingle();

    if (proofError) {
        return { success: false, deleted: false, error: proofError.message };
    }

    if (!proof) {
        return { success: true, deleted: false };
    }

    const bucket = (proof.bucket as string) || TASK_PROOFS_BUCKET;
    const objectPath = proof.object_path as string;

    if (objectPath) {
        const { error: storageDeleteError } = await supabaseAdmin.storage
            .from(bucket)
            .remove([objectPath]);

        if (storageDeleteError) {
            console.error(`Failed to delete proof object for task ${taskId} (${reason}):`, storageDeleteError);
            return { success: false, deleted: false, error: storageDeleteError.message };
        }
    }

    const { error: rowDeleteError } = await (supabaseAdmin.from("task_completion_proofs") as any)
        .delete()
        .eq("task_id", taskId as any);

    if (rowDeleteError) {
        console.error(`Failed to delete proof row for task ${taskId} (${reason}):`, rowDeleteError);
        return { success: false, deleted: false, error: rowDeleteError.message };
    }

    return { success: true, deleted: true };
}
