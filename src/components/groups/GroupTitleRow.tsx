'use client';
import { useRef, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, FolderPlus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GroupStatusBadge, type GroupHistoryStatus } from '@/design-system/statuspills';

export interface GroupTitleRowProps {
    title: string;
    expanded: boolean;
    onToggle: () => void;
    onOpen: () => void;
    onDelete: () => void;
    onComplete?: () => void;
    onPrefetch?: () => void;
    completeControl?: ReactNode;
    deadline?: string;
    overdue?: boolean;
    historyStatus?: GroupHistoryStatus;
    muted?: boolean;
}
export function GroupTitleRow({ title, expanded, onToggle, onOpen, onDelete, onComplete, onPrefetch, completeControl, deadline, overdue, historyStatus, muted }: GroupTitleRowProps) {
    const start = useRef<{ x: number; y: number } | null>(null);
    const skipClick = useRef(false);
    return <div className={cn('group flex items-center gap-3 py-2 md:py-3 rounded-md hover:bg-slate-900/20 -mx-4 px-4 transition-[background-color,opacity]', (muted || historyStatus) && 'opacity-40 hover:opacity-100')} onMouseEnter={onPrefetch} onFocus={onPrefetch} onTouchStart={event => {
        const touch = event.touches[0];
        start.current = { x: touch.clientX, y: touch.clientY }; skipClick.current = false;
        onPrefetch?.();
    }} onTouchEnd={event => {
        const touch = event.changedTouches[0], initial = start.current;
        start.current = null;
        if (!initial) return;
        const dx = touch.clientX - initial.x, dy = touch.clientY - initial.y;
        if (Math.abs(dx) < 65 || Math.abs(dx) <= Math.abs(dy)) return;
        skipClick.current = true;
        if (dx < 0) onDelete(); else onComplete?.();
    }}>
        {!historyStatus && completeControl}
        <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title} group`} onClick={() => { if (!skipClick.current) onToggle(); skipClick.current = false; }} onDoubleClick={onOpen}>
            <span className="min-w-0 truncate text-lg font-medium text-white">{title}</span><FolderPlus className="size-4 shrink-0 text-cyan-400" />{expanded ? <ChevronDown className="size-4 shrink-0 text-slate-400" /> : <ChevronRight className="size-4 shrink-0 text-slate-400" />}
        </button>
        {historyStatus ? <GroupStatusBadge status={historyStatus} className="shrink-0" /> : deadline && <span suppressHydrationWarning className={cn('text-xs shrink-0 whitespace-nowrap', overdue ? 'text-red-500' : 'text-slate-400')}>{deadline}</span>}
        <button type="button" onClick={onDelete} aria-label={`Delete ${title} group`} className="hidden md:flex h-10 w-10 items-center justify-center text-red-400"><Trash2 className="size-4" /></button>
        <button type="button" onClick={onOpen} aria-label={`Open ${title} group details`} className="hidden md:flex h-10 w-10 items-center justify-center text-slate-400"><ExternalLink className="size-4" /></button>
    </div>;
}
