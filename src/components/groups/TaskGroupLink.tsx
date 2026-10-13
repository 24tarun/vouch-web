'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FolderPlus, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useGroups } from './use-groups';
import { belongsToGroup } from '@/lib/groups/dashboard';
import { linkTaskToGroup } from '@/actions/groups';
import type { Task } from '@/lib/types';
import { toast } from 'sonner';
export function TaskGroupLink({ task }: { task: Task }) {
    const { groups, loading, error, refresh } = useGroups([], task.user_id);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const router = useRouter();
    const linked = groups.filter(group => belongsToGroup(task, group));
    async function attach(id: string) {
        if (busy) return;
        setBusy(true);
        try {
            const result = await linkTaskToGroup(id, task.id);
            if ('error' in result) { toast.error(result.error); return; }
            await refresh(); setOpen(false); router.refresh();
        } finally { setBusy(false); }
    }
    return <><button type="button" onClick={() => setOpen(true)} className="flex w-full items-center justify-between gap-3 min-h-[32px]" aria-label={linked.length ? `Manage linked groups: ${linked.map(group => group.name).join(', ')}` : 'Add task to group'}><span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-400"><FolderPlus className={linked.length ? 'size-4 text-cyan-400' : 'size-4'} />Group</span><span className={linked.length ? 'text-xs text-right text-cyan-400' : 'text-xs text-slate-400'}>{linked.length ? linked.map(group => group.name).join(', ') : loading ? 'Loading groups…' : 'Add to group'}</span></button><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogTitle>Groups</DialogTitle><DialogDescription>{task.recurrence_rule_id ? 'Link this recurring series; future tasks join automatically.' : 'Choose a group for this task.'}</DialogDescription><div className="max-h-80 overflow-y-auto space-y-2">{loading && <p>Loading groups…</p>}{error && <button onClick={() => void refresh()}>Could not load groups. Retry</button>}{groups.map(group => belongsToGroup(task, group) ? <Link key={group.id} className="block rounded-lg p-3 text-cyan-400" href={`/commit/${group.id}`}>{group.name}</Link> : <button key={group.id} disabled={busy} onClick={() => void attach(group.id)} className="flex w-full items-center justify-between rounded-lg p-3 text-left">{group.name}<Plus className="size-4 text-cyan-400" /></button>)}</div><button disabled={busy} onClick={() => router.push(`/tasks?groups=create&groupTaskId=${encodeURIComponent(task.id)}`)} className="flex items-center gap-2 p-3 text-cyan-400"><FolderPlus className="size-4" />Create new group</button></DialogContent></Dialog></>;
}
