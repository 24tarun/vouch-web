export async function claimRowsByIdsWithTimestamp(
    table: string,
    supabase: any,
    ids: string[],
    timestampIso: string
): Promise<{ id: string }[]> {
    if (ids.length === 0) return [];
    const { data, error } = await (supabase.from(table) as any)
        .update({ notified_at: timestampIso } as any)
        .in("id", ids as any)
        .is("notified_at", null)
        .select("id");
    if (error) {
        throw new Error(error.message || `Failed to claim rows in ${table}`);
    }
    return ((data as Array<{ id: string }> | null) || []);
}

export async function rollbackClaimByTimestamp(
    table: string,
    supabase: any,
    ids: string[],
    timestampIso: string
): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await (supabase.from(table) as any)
        .update({ notified_at: null } as any)
        .in("id", ids as any)
        .eq("notified_at", timestampIso as any);
    if (error) {
        throw new Error(error.message || `Failed to rollback claims in ${table}`);
    }
}

export async function claimTasksByIdsAndStatus(
    supabase: any,
    taskIds: string[],
    fromStatus: string,
    patch: Record<string, unknown>
): Promise<string[]> {
    if (taskIds.length === 0) return [];
    const { data, error } = await (supabase.from("tasks") as any)
        .update(patch as any)
        .in("id", taskIds as any)
        .eq("status", fromStatus as any)
        .select("id");
    if (error) {
        throw new Error(error.message || `Failed claiming tasks from ${fromStatus}`);
    }
    return (((data as Array<{ id: string }> | null) || []).map((row) => row.id));
}
