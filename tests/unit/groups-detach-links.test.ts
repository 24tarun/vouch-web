import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { withDetachedGroupLinks } from '../../src/lib/groups/detach-links';

function clientFor(events: string[], restoreError?: string) {
    const links = [{ id: 'link', commitment_id: 'group', task_id: 'weight', recurrence_rule_id: null, created_at: '' }];
    return { from: () => {
        let operation = 'read';
        const query = {
            select: () => query, eq: () => query, order: () => query, range: () => query, in: () => query,
            delete: () => { operation = 'detach'; return query; },
            upsert: () => { operation = 'restore'; return query; },
            then: (resolve: (result: unknown) => unknown) => { events.push(operation); return Promise.resolve(resolve({ data: links, error: operation === 'restore' && restoreError ? { message: restoreError } : null })); },
        };
        return query;
    } } as unknown as SupabaseClient;
}
for (const target of ['task_id', 'recurrence_rule_id'] as const) test(`detaches ${target} references before deleting the target`, async () => {
    const events: string[] = [];
    const result = await withDetachedGroupLinks(clientFor(events), target, 'weight', async () => { events.push('command'); return {}; });
    assert.equal('error' in result ? result.error : undefined, undefined);
    assert.deepEqual(events, ['read', 'detach', 'command']);
});
test('rejected deletion restores membership', async () => {
    const events: string[] = [];
    const result = await withDetachedGroupLinks(clientFor(events), 'task_id', 'weight', async () => ({ error: 'Protected task' }));
    assert.equal(result.error, 'Protected task');
    assert.deepEqual(events, ['read', 'detach', 'restore']);
});
test('failed restoration is visible to the caller', async () => {
    const result = await withDetachedGroupLinks(clientFor([], 'Network failure'), 'recurrence_rule_id', 'rule', async () => { throw new Error('Deletion failed'); });
    assert.match(result.error || '', /Some group links could not be restored: Network failure/);
});
