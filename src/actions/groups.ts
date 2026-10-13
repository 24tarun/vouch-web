'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { Commitment, CommitmentTaskLink, Task } from '@/lib/types';
import type { ResolvedGroup } from '@/lib/groups/dashboard';
import { ownerTempDeleteTask, cancelRepetition } from '@/actions/tasks';
import { canOwnerTemporarilyDelete } from '@/lib/task-delete-window';
import { withDetachedGroupLinks } from '@/lib/groups/detach-links';
import { invalidateActiveTasksCache } from '@/actions/tasks/helpers';

type Client = SupabaseClient;
async function authenticate() {
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    return { client: client as SupabaseClient, user };
}
async function linksFor(client: Client, ids: string[]) {
    const links: CommitmentTaskLink[] = [];
    for (let batch = 0; batch < ids.length; batch += 100) {
        for (let offset = 0; ; offset += 500) {
            const result = await client.from('commitment_task_links').select('*').in('commitment_id', ids.slice(batch, batch + 100)).order('id').range(offset, offset + 499);
            if (result.error) throw new Error(result.error.message);
            links.push(...(result.data || []) as CommitmentTaskLink[]);
            if ((result.data?.length || 0) < 500) break;
        }
    }
    return links;
}
function refresh(groupId?: string) {
    revalidatePath('/tasks');
    revalidatePath('/commit');
    if (groupId) revalidatePath(`/commit/${groupId}`);
}
export async function getGroups(): Promise<ResolvedGroup[]> {
    const { client, user } = await authenticate();
    const groups: Commitment[] = [];
    for (let offset = 0; ; offset += 500) {
        const result = await client.from('commitments').select('*').eq('user_id', user.id).order('id').range(offset, offset + 499);
        if (result.error) throw new Error(result.error.message);
        groups.push(...(result.data || []) as Commitment[]);
        if ((result.data?.length || 0) < 500) break;
    }
    const links = await linksFor(client, groups.map(group => group.id));
    const members = new Map<string, Task>();
    for (const target of ['task_id', 'recurrence_rule_id'] as const) {
        const ids = [...new Set(links.map(link => link[target]).filter((id): id is string => !!id))];
        for (let batch = 0; batch < ids.length; batch += 100) {
            for (let offset = 0; ; offset += 500) {
                const result = await client.from('tasks').select('*, recurrence_rule:recurrence_rules(*)').eq('user_id', user.id).in(target === 'task_id' ? 'id' : target, ids.slice(batch, batch + 100)).neq('status', 'DELETED').order('id').range(offset, offset + 499);
                if (result.error) throw new Error(result.error.message);
                for (const task of (result.data || []) as Task[]) members.set(task.id, task);
                if ((result.data?.length || 0) < 500) break;
            }
        }
    }
    const taskIds = [...members.keys()];
    // Include the same completion prerequisites as normal dashboard rows.
    for (let batch = 0; batch < taskIds.length; batch += 100) {
        const ids = taskIds.slice(batch, batch + 100);
        for (const table of ['task_subtasks', 'pomo_sessions', 'task_completion_proofs'] as const) {
            for (let offset = 0; ; offset += 500) {
                let query = client.from(table).select('*').in(table === 'task_subtasks' ? 'parent_task_id' : 'task_id', ids).order('id').range(offset, offset + 499);
                if (table === 'pomo_sessions') query = query.neq('status', 'DELETED');
                if (table === 'task_completion_proofs') query = query.eq('upload_state', 'UPLOADED');
                const result = await query;
                if (result.error) throw new Error(result.error.message);
                for (const row of result.data || []) {
                    const task = members.get(table === 'task_subtasks' ? row.parent_task_id : row.task_id);
                    if (!task) continue;
                    if (table === 'task_subtasks') (task.subtasks ||= []).push(row);
                    if (table === 'pomo_sessions') task.pomo_total_seconds = (task.pomo_total_seconds || 0) + (row.elapsed_seconds || 0);
                    if (table === 'task_completion_proofs') task.completion_proof = row;
                }
                if ((result.data?.length || 0) < 500) break;
            }
        }
    }
    return groups.map(group => {
        const membership = links.filter(link => link.commitment_id === group.id);
        return { ...group, status: 'ACTIVE', links: membership, members: [...members.values()].filter(task => membership.some(link => link.task_id === task.id || !!link.recurrence_rule_id && link.recurrence_rule_id === task.recurrence_rule_id)) };
    });
}
export async function linkTaskToGroup(groupId: string, taskId: string) {
    try {
        const { client, user } = await authenticate();
        const [group, task] = await Promise.all([
            client.from('commitments').select('id').eq('id', groupId).eq('user_id', user.id).maybeSingle(),
            client.from('tasks').select('*').eq('id', taskId).eq('user_id', user.id).neq('status', 'DELETED').maybeSingle(),
        ]);
        if (group.error || task.error) throw new Error(group.error?.message || task.error?.message);
        if (!group.data || !task.data) throw new Error('Group or task not found.');
        const ownedTask = task.data as Task;
        const existing = await linksFor(client, [groupId]);
        if (!existing.some(link => link.task_id === taskId || ownedTask.recurrence_rule_id && link.recurrence_rule_id === ownedTask.recurrence_rule_id)) {
            const result = await client.from('commitment_task_links').insert({ commitment_id: groupId, task_id: ownedTask.recurrence_rule_id ? null : taskId, recurrence_rule_id: ownedTask.recurrence_rule_id || null });
            if (result.error) throw new Error(result.error.message);
        }
        refresh(groupId);
        revalidatePath(`/tasks/${taskId}`);
        return { success: true as const };
    } catch (error) { return { error: error instanceof Error ? error.message : 'Could not link task.' }; }
}
export async function createGroup(name: string, sourceTaskId?: string) {
    try {
        const { client, user } = await authenticate();
        const title = name.trim();
        if (!title || title.length > 100) throw new Error('Group title must be between 1 and 100 characters.');
        if (sourceTaskId) {
            const source = await client.from('tasks').select('id').eq('id', sourceTaskId).eq('user_id', user.id).neq('status', 'DELETED').maybeSingle();
            if (source.error || !source.data) throw new Error(source.error?.message || 'Task not found.');
        }
        const result = await client.from('commitments').insert({ user_id: user.id, name: title, description: '[mobile:title-only-group]', status: 'ACTIVE', start_date: '1970-01-01', end_date: '9999-12-31' }).select('id').single();
        if (result.error) throw new Error(result.error.message);
        const groupId = result.data.id as string;
        refresh(groupId);
        if (sourceTaskId) {
            const linked = await linkTaskToGroup(groupId, sourceTaskId);
            if ('error' in linked) return { groupId, error: `Group created, but task could not be linked: ${linked.error}` };
        }
        return { success: true as const, groupId };
    } catch (error) { return { error: error instanceof Error ? error.message : 'Could not create group.' }; }
}
export async function deleteGroup(groupId: string, deleteLinkedTasks: boolean) {
    let deletedTasks = 0, stoppedSeries = 0;
    try {
        const { client, user } = await authenticate();
        const group = await client.from('commitments').select('id').eq('id', groupId).eq('user_id', user.id).maybeSingle();
        if (group.error || !group.data) throw new Error(group.error?.message || 'Group not found.');
        if (deleteLinkedTasks) {
            const links = await linksFor(client, [groupId]);
            const taskIds = [...new Set(links.flatMap(link => link.task_id ? [link.task_id] : []))];
            const tasks: Task[] = [];
            for (let offset = 0; offset < taskIds.length; offset += 100) {
                const result = await client.from('tasks').select('*').eq('user_id', user.id).in('id', taskIds.slice(offset, offset + 100));
                if (result.error) throw new Error(result.error.message);
                tasks.push(...(result.data || []) as Task[]);
            }
            // Snapshot recurring targets before rule deletion clears their task foreign keys.
            const rules = new Set(links.flatMap(link => link.recurrence_rule_id ? [link.recurrence_rule_id] : []));
            tasks.forEach(task => { if (task.recurrence_rule_id) rules.add(task.recurrence_rule_id); });
            for (const task of tasks.filter(task => !task.recurrence_rule_id && canOwnerTemporarilyDelete(task))) {
                const result = await ownerTempDeleteTask(task.id);
                if (result.error) throw new Error(result.error);
                deletedTasks++;
            }
            for (const ruleId of rules) {
                const instance = tasks.find(task => task.recurrence_rule_id === ruleId);
                if (instance) {
                    const result = await cancelRepetition(instance.id);
                    if (result.error) throw new Error(result.error);
                } else {
                    const rule = await client.from('recurrence_rules').select('id').eq('id', ruleId).eq('user_id', user.id).maybeSingle();
                    if (rule.error) throw new Error(rule.error.message);
                    if (rule.data) {
                        const result = await withDetachedGroupLinks(client, 'recurrence_rule_id', ruleId, async () => {
                            const deleted = await client.from('recurrence_rules').delete().eq('id', ruleId).eq('user_id', user.id);
                            return deleted.error ? { error: deleted.error.message } : {};
                        });
                        if (result.error) throw new Error(result.error);
                    }
                }
                invalidateActiveTasksCache(user.id);
                stoppedSeries++;
            }
        }
        const deleted = await client.from('commitments').delete().eq('id', groupId).eq('user_id', user.id).select('id').maybeSingle();
        if (deleted.error || !deleted.data) throw new Error(deleted.error?.message || 'Group could not be deleted.');
        invalidateActiveTasksCache(user.id);
        refresh(groupId);
        revalidatePath('/settings');
        return { success: true as const, deletedTasks, stoppedSeries };
    } catch (error) {
        refresh(groupId);
        return { error: `${error instanceof Error ? error.message : 'Deletion failed.'} The group was kept.${deletedTasks || stoppedSeries ? ` ${deletedTasks} task(s) deleted; ${stoppedSeries} series stopped.` : ''}` };
    }
}
export async function getGroupTaskHistory(cursor?: { updated_at: string; id: string }) {
    const { client, user } = await authenticate();
    let query = client.from('tasks').select('*').eq('user_id', user.id).not('status', 'in', '(ACTIVE,POSTPONED,DELETED)').order('updated_at', { ascending: false }).order('id', { ascending: false }).limit(20);
    if (cursor) {
        if (!Number.isFinite(Date.parse(cursor.updated_at)) || !/^[a-f0-9-]{36}$/i.test(cursor.id)) throw new Error('Invalid history cursor.');
        query = query.or(`updated_at.lt.${new Date(cursor.updated_at).toISOString()},and(updated_at.eq.${new Date(cursor.updated_at).toISOString()},id.lt.${cursor.id})`);
    }
    const result = await query;
    if (result.error) throw new Error(result.error.message);
    const tasks = (result.data || []) as Task[];
    const last = tasks.at(-1);
    return { tasks, hasMore: tasks.length === 20, cursor: last ? { updated_at: last.updated_at, id: last.id } : null };
}
export async function getGroupLinkOptions() {
    const { client, user } = await authenticate();
    const options: Array<{ id: string; title: string; type: 'task' | 'series' }> = [];
    for (const table of ['tasks', 'recurrence_rules'] as const) {
        for (let offset = 0; ; offset += 500) {
            let query = client.from(table).select('id, title').eq('user_id', user.id).order('id').range(offset, offset + 499);
            if (table === 'tasks') query = query.in('status', ['ACTIVE', 'POSTPONED']).is('recurrence_rule_id', null);
            const result = await query;
            if (result.error) throw new Error(result.error.message);
            options.push(...(result.data || []).map(row => ({ id: row.id as string, title: row.title as string, type: table === 'tasks' ? 'task' as const : 'series' as const })));
            if ((result.data?.length || 0) < 500) break;
        }
    }
    return options;
}
export async function linkSeriesToGroup(groupId: string, ruleId: string) {
    try {
        const { client, user } = await authenticate();
        const [group, rule] = await Promise.all([
            client.from('commitments').select('id').eq('id', groupId).eq('user_id', user.id).maybeSingle(),
            client.from('recurrence_rules').select('id').eq('id', ruleId).eq('user_id', user.id).maybeSingle(),
        ]);
        if (group.error || rule.error) throw new Error(group.error?.message || rule.error?.message);
        if (!group.data || !rule.data) throw new Error('Group or series not found.');
        const links = await linksFor(client, [groupId]);
        if (!links.some(link => link.recurrence_rule_id === ruleId)) {
            const result = await client.from('commitment_task_links').insert({ commitment_id: groupId, recurrence_rule_id: ruleId, task_id: null });
            if (result.error) throw new Error(result.error.message);
        }
        refresh(groupId);
        return { success: true as const };
    } catch (error) { return { error: error instanceof Error ? error.message : 'Could not link series.' }; }
}
