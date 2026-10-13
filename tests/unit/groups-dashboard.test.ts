import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroupDashboard, belongsToGroup, groupDate, type ResolvedGroup } from '../../src/lib/groups/dashboard';
import type { Task } from '../../src/lib/types';

const date = '2026-09-17';
const nowMs = Date.parse(`${date}T05:00:00Z`);
function task(id: string, hour: number, status: Task['status'] = 'ACTIVE'): Task {
    return { id, title: id, user_id: 'owner', voucher_id: 'voucher', description: null, failure_cost_cents: 100, required_pomo_minutes: null, deadline: `${date}T${String(hour - 2).padStart(2, '0')}:00:00Z`, status, recurrence_rule_id: `rule-${id}`, created_at: '2026-09-16T12:00:00Z', updated_at: `${date}T05:00:00Z`, postponed_at: null, marked_completed_at: null, voucher_response_deadline: null, google_sync_for_task: false };
}
const members = [task('weight', 8), task('skincare', 9), task('calcium', 10)];
function group(overrides: Partial<ResolvedGroup> = {}): ResolvedGroup {
    return { id: 'morning', name: 'Morning routine', user_id: 'owner', description: '', status: 'ACTIVE', start_date: date, end_date: date, created_at: '2026-09-16T09:00:00Z', updated_at: '2026-09-16T09:00:00Z', members, links: members.map(member => ({ id: `link-${member.id}`, commitment_id: 'morning', task_id: null, recurrence_rule_id: member.recurrence_rule_id, created_at: '' })), ...overrides };
}
function dashboard(groups = [group()], rows = members, changes: Partial<Parameters<typeof buildGroupDashboard>[0]> = {}) {
    return buildGroupDashboard({ groups, dueSoonTasks: rows.filter(row => ['ACTIVE', 'POSTPONED'].includes(row.status)), futureTasks: [], pastTasks: rows.filter(row => !['ACTIVE', 'POSTPONED'].includes(row.status)), timezone: 'Europe/Berlin', nowMs, sortMode: 'deadline_asc', futureBoundaryMs: Date.parse('2026-09-18T22:00:00Z'), ...changes });
}
function representative(result: ReturnType<typeof dashboard>) {
    const row = result.dueSoon.find(row => row.kind === 'group');
    return row?.kind === 'group' ? row.representative.id : undefined;
}
test('group deadline advances 08 → 09 → 10 during verification and undo restores 08', () => {
    const rows = members.map(row => ({ ...row }));
    assert.equal(representative(dashboard([group()], rows)), 'weight');
    rows[0].status = 'AWAITING_VOUCHER';
    assert.equal(representative(dashboard([group()], rows)), 'skincare');
    rows[1].status = 'AWAITING_AI';
    assert.equal(representative(dashboard([group()], rows)), 'calcium');
    rows[2].status = 'ACCEPTED';
    assert.equal(dashboard([group()], rows).dueSoon.length, 0);
    assert.equal(dashboard([group()], rows).past[0].kind, 'group-history');
    rows[0].status = 'ACTIVE';
    assert.equal(representative(dashboard([group()], rows)), 'weight');
});
test('missed projection advances while preserving the original member', () => {
    assert.equal(representative(dashboard([group()], members, { nowMs: Date.parse(`${date}T06:01:00Z`) })), 'skincare');
    assert.equal(members[0].status, 'ACTIVE');
});
test('postponement changes the representative independently of dashboard sorting', () => {
    const rows = [{ ...members[0], deadline: `${date}T08:30:00Z`, status: 'POSTPONED' as const }, ...members.slice(1)];
    assert.equal(representative(dashboard([group()], rows, { sortMode: 'deadline_desc' })), 'skincare');
});
test('shared and duplicate links retain one member per group and deletion restores ordinary rows', () => {
    const first = group(); first.links.push(first.links[0]);
    const projected = dashboard([first, group({ id: 'shared' })]);
    assert.equal(projected.dueSoon.length, 2);
    assert.ok(projected.dueSoon.every(row => row.kind === 'group' && row.representative.id === 'weight'));
    assert.equal(dashboard([]).dueSoon.filter(row => row.kind === 'task').length, 3);
});
test('legacy states and date windows do not prevent grouping generated instances', () => {
    const generated = { ...members[0], id: 'future-instance', deadline: '2026-10-18T06:00:00Z' };
    assert.ok(belongsToGroup(generated, group({ status: 'DRAFT' })));
    assert.equal(dashboard([group({ status: 'DRAFT' })]).dueSoon[0].kind, 'group');
    assert.equal(dashboard([group({ members: [], links: [] })], []).dueSoon[0].kind, 'group-empty');
});
test('daily summary reads complete membership beyond the fetched history page', () => {
    const rows = members.map(member => ({ ...member, status: 'ACCEPTED' as Task['status'], deadline: member.deadline.replace(date, '2026-09-16') }));
    rows[2].status = 'MISSED';
    const result = dashboard([group({ members: rows })], [], { pastTasks: [rows[0]] });
    assert.equal(result.past.length, 1);
    assert.equal(result.past[0].kind === 'group-history' && result.past[0].summary, 'failed');
});
test('today history can coexist with a future live group without duplicate ordinary member rows', () => {
    const rows = members.map(member => ({ ...member, status: 'ACCEPTED' as const }));
    const future = { ...members[0], id: 'future', deadline: '2026-09-20T06:00:00Z' };
    const result = dashboard([group({ members: [...rows, future] })], rows);
    assert.equal(result.future.length, 1);
    assert.equal(result.past.length, 1);
    assert.equal(result.past[0].kind === 'group-history' && result.past[0].summary, 'completed');
});
test('group dates follow Berlin local midnight and DST', () => {
    assert.equal(groupDate('2026-09-16T22:30:00Z', 'Europe/Berlin'), date);
    assert.equal(groupDate('2026-10-25T22:30:00Z', 'Europe/Berlin'), '2026-10-25');
    assert.equal(groupDate('2026-10-25T23:30:00Z', 'Europe/Berlin'), '2026-10-26');
});
