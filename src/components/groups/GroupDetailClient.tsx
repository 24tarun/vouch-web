'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Plus, Trash2 } from 'lucide-react';
import { TaskRow } from '@/components/TaskRow';
import { useGroups } from './use-groups';
import { DeleteGroupDialog } from './DeleteGroupDialog';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { ResolvedGroup } from '@/lib/groups/dashboard';
import type { Task } from '@/lib/types';
import { sortDashboardTasks } from '@/lib/groups/sort';
import { getGroupLinkOptions, linkSeriesToGroup, linkTaskToGroup } from '@/actions/groups';
import { toast } from 'sonner';
export function GroupDetailClient({ group, candidates }: { group: ResolvedGroup; candidates: Task[] }) {
    const { groups, refresh, error } = useGroups([group], group.user_id);
    const item = groups.find(item => item.id === group.id) || group;
    const router = useRouter();
    const [options, setOptions] = useState<Array<{ id: string; title: string; type: 'task' | 'series' }>>(candidates.filter(task => !task.recurrence_rule_id).map(task => ({ id: task.id, title: task.title, type: 'task' })));
    const [pickerError, setPickerError] = useState<string | null>(null);
    const [picker, setPicker] = useState(false);
    useEffect(() => {
        if (!picker) return;
        let live = true;
        getGroupLinkOptions().then(next => { if (live) { setOptions(next); setPickerError(null); } }).catch(error => { if (live) setPickerError(error instanceof Error ? error.message : 'Could not load tasks.'); });
        return () => { live = false; };
    }, [picker]);
    const [deleting, setDeleting] = useState(false);
    const [busy, setBusy] = useState(false);
    const [search, setSearch] = useState('');
    const [limit, setLimit] = useState(20);
    async function attach(task: { id: string; type: 'task' | 'series' }) {
        if (busy) return;
        setBusy(true);
        try {
            const result = await (task.type === 'series' ? linkSeriesToGroup(item.id, task.id) : linkTaskToGroup(item.id, task.id));
            if ('error' in result) { toast.error(result.error); return; }
            await refresh(); setPicker(false);
        } finally { setBusy(false); }
    }
    const deduped = options.filter(option => !item.links.some(link => option.type === 'series' ? link.recurrence_rule_id === option.id : link.task_id === option.id)).filter(option => option.title.toLowerCase().includes(search.toLowerCase()));
    const members = sortDashboardTasks(item.members, 'deadline_asc');
    return <div className="max-w-4xl mx-auto px-4 md:px-0 pb-14"><header className="flex items-center gap-2 pb-4 mb-4 border-b border-slate-800"><button aria-label="Back to tasks" onClick={() => window.history.length > 1 ? router.back() : router.push('/tasks')} className="p-2"><ChevronLeft className="size-5" /></button><h1 className="flex-1 min-w-0 text-center text-2xl font-bold break-words">{item.name}</h1><button aria-label="Link task to group" onClick={() => setPicker(true)} className="p-2 text-cyan-400"><Plus className="size-5" /></button><button aria-label="Delete group" onClick={() => setDeleting(true)} className="p-2 text-red-400"><Trash2 className="size-5" /></button></header>{error && <button onClick={() => void refresh()} className="text-amber-400">Could not refresh groups. Retry</button>}{members.slice(0, limit).map(task => <TaskRow key={task.id} task={task} layoutVariant={['ACTIVE', 'POSTPONED'].includes(task.status) ? 'active' : 'completed'} />)}{!members.length && <p className="text-slate-500">No tasks yet.</p>}{members.length > limit && <button onClick={() => setLimit(limit + 20)}>Show more tasks</button>}<DeleteGroupDialog groupId={deleting ? item.id : null} onClose={() => setDeleting(false)} onDeleted={() => router.push('/tasks')} /><Dialog open={picker} onOpenChange={setPicker}><DialogContent><DialogTitle>Link a task</DialogTitle><DialogDescription>Choose an existing task or create one directly in this group.</DialogDescription><button disabled={busy} className="flex items-center gap-2 p-2 text-cyan-400" onClick={() => router.push(`/tasks?createTaskInGroup=${item.id}`)}><Plus className="size-4" />Create task</button><input aria-label="Search tasks or series" placeholder="Search tasks or series…" value={search} onChange={event => setSearch(event.target.value)} className="rounded-lg bg-slate-800 p-3" /><div className="max-h-80 overflow-auto">{pickerError && <p role="alert" className="text-red-400">{pickerError}</p>}{deduped.map(task => <button disabled={busy} key={task.id} className="flex w-full items-center justify-between p-3 text-left" onClick={() => void attach(task)}><span>{task.title}{task.type === 'series' && <span className="ml-2 text-xs text-purple-400">Repeating</span>}</span><Plus className="size-4 text-cyan-400" /></button>)}</div></DialogContent></Dialog></div>;
}
