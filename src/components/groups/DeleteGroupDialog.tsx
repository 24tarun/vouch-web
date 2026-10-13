'use client';
import { useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { deleteGroup } from '@/actions/groups';
import { toast } from 'sonner';
export function GroupDeletionChoices({ busy = false, onKeep, onDelete, onCancel }: { busy?: boolean; onKeep: () => void; onDelete: () => void; onCancel: () => void }) {
    return <div className="flex flex-col gap-2"><button disabled={busy} onClick={onKeep} className="rounded-lg bg-slate-800 p-3">Keep linked tasks</button><button disabled={busy} onClick={onDelete} className="rounded-lg bg-red-500/15 p-3 text-red-400">Delete linked tasks</button><button disabled={busy} onClick={onCancel} className="p-2 text-slate-400">Cancel</button></div>;
}
export function DeleteGroupDialog({ groupId, onClose, onDeleted }: { groupId: string | null; onClose: () => void; onDeleted: () => void }) {
    const [busy, setBusy] = useState(false);
    const lock = useRef(false);
    async function remove(deleteLinkedTasks: boolean) {
        if (!groupId || lock.current) return;
        lock.current = true; setBusy(true);
        try {
            const result = await deleteGroup(groupId, deleteLinkedTasks);
            if ('error' in result) { toast.error(result.error); return; }
            onDeleted(); onClose();
        } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not delete group.'); }
        finally { lock.current = false; setBusy(false); }
    }
    return <Dialog open={!!groupId} onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent><DialogTitle>Delete group?</DialogTitle><DialogDescription>Keep linked tasks, or delete eligible tasks and stop linked recurring series. Existing recurring instances, protected tasks, history and ledger entries remain. Stopping a shared series affects every group using it.</DialogDescription><GroupDeletionChoices busy={busy} onKeep={() => void remove(false)} onDelete={() => void remove(true)} onCancel={onClose} /></DialogContent></Dialog>;
}
