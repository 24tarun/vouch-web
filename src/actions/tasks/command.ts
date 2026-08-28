import type { SupabaseClient } from "@supabase/supabase-js";

export type TaskCommandResult =
    | {
        success: true;
        task: Record<string, unknown> | null;
        deletedTaskId?: string;
        fromStatus: string;
        toStatus: string | null;
        proofStorage?: {
            bucket: string;
            objectPath: string;
        } | null;
    }
    | {
        success: false;
        code: string;
        message: string;
    };

export async function runTaskCommand(
    supabase: SupabaseClient,
    functionName: string,
    args: Record<string, unknown>
): Promise<TaskCommandResult> {
    const { data, error } = await supabase.rpc(functionName as never, args as never);
    if (error) {
        return { success: false, code: "QUEUE_FAILED", message: error.message };
    }
    const result = (Array.isArray(data) ? data[0] : data) as TaskCommandResult | null;
    if (!result || typeof result.success !== "boolean") {
        return { success: false, code: "QUEUE_FAILED", message: "Task command returned an invalid response." };
    }
    return result;
}

export async function runOrchestratedTaskCommand(
    supabase: SupabaseClient,
    body: Record<string, unknown>
): Promise<TaskCommandResult> {
    const { data, error } = await supabase.functions.invoke("task-proof-upload", { body });
    if (error) {
        let payload: Record<string, unknown> | null = null;
        const response = (error as { context?: { json?: () => Promise<unknown> } }).context;
        if (response?.json) {
            try {
                payload = await response.json() as Record<string, unknown>;
            } catch {
                // Preserve the transport message when the response is not JSON.
            }
        }
        return {
            success: false,
            code: String(payload?.code ?? "QUEUE_FAILED"),
            message: String(payload?.message ?? payload?.error ?? error.message),
        };
    }
    const result = data as TaskCommandResult | null;
    return result && typeof result.success === "boolean"
        ? result
        : { success: false, code: "QUEUE_FAILED", message: "Task command returned an invalid response." };
}
