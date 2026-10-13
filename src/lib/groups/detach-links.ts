import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommitmentTaskLink } from '@/lib/types';

type Client = SupabaseClient;
export async function withDetachedGroupLinks<T extends { error?: string }>(client: Client, target: 'task_id' | 'recurrence_rule_id', id: string, run: () => Promise<T>): Promise<T | { error: string }> {
    const removed: CommitmentTaskLink[] = [];
    try {
        const ids: string[] = [];
        for (let offset = 0; ; offset += 500) {
            const result = await client.from('commitment_task_links').select('id').eq(target, id).order('id').range(offset, offset + 499);
            if (result.error) throw new Error(result.error.message);
            ids.push(...(result.data || []).map(row => row.id));
            if ((result.data?.length || 0) < 500) break;
        }
        for (let offset = 0; offset < ids.length; offset += 100) {
            const result = await client.from('commitment_task_links').delete().eq(target, id).in('id', ids.slice(offset, offset + 100)).select('*');
            if (result.error) throw new Error(result.error.message);
            removed.push(...(result.data || []) as CommitmentTaskLink[]);
        }
        const result = await run();
        if (result.error) throw new Error(result.error);
        return result;
    } catch (error) {
        let message = error instanceof Error ? error.message : 'Deletion failed.';
        for (let offset = 0; offset < removed.length; offset += 100) {
            const result = await client.from('commitment_task_links').upsert(removed.slice(offset, offset + 100), { onConflict: 'id', ignoreDuplicates: true });
            if (result.error) { message += ` Some group links could not be restored: ${result.error.message}`; break; }
        }
        return { error: message };
    }
}
