'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getGroups } from '@/actions/groups';
import type { ResolvedGroup } from '@/lib/groups/dashboard';
import { fromZonedTime } from 'date-fns-tz';
import { groupDate } from '@/lib/groups/dashboard';
import { getNextMissedProjectionAt } from '@/lib/groups/effective-status';

export function useGroups(initial: ResolvedGroup[] = [], userId?: string, timezone?: string) {
    const [groups, setGroups] = useState(initial);
    const [loading, setLoading] = useState(initial.length === 0);
    const [error, setError] = useState<string | null>(null);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const request = useRef(0);
    const mounted = useRef(true);
    const client = useMemo(() => createClient(), []);
    const refresh = useCallback(async () => {
        const version = ++request.current;
        try {
            const next = await getGroups();
            if (mounted.current && version === request.current) { setGroups(next); setError(null); }
        } catch (error) {
            if (mounted.current && version === request.current) setError(error instanceof Error ? error.message : 'Could not load groups.');
        } finally { if (mounted.current && version === request.current) setLoading(false); }
    }, []);
    useEffect(() => {
        mounted.current = true;
        void refresh();
        const foreground = () => { if (document.visibilityState === 'visible') { setNowMs(Date.now()); void refresh(); } };
        window.addEventListener('focus', foreground);
        document.addEventListener('visibilitychange', foreground);
        const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
        const channel = client.channel(`groups:${userId || 'owner'}`);
        for (const table of ['commitments', 'commitment_task_links', 'tasks', 'recurrence_rules']) {
            channel.on('postgres_changes', { event: '*', schema: 'public', table, ...(userId && table !== 'commitment_task_links' ? { filter: `user_id=eq.${userId}` } : {}) }, () => { void refresh(); });
        }
        channel.subscribe();
        return () => { mounted.current = false; window.clearInterval(timer); window.removeEventListener('focus', foreground); document.removeEventListener('visibilitychange', foreground); void client.removeChannel(channel); };
    }, [client, refresh, userId]);
    useEffect(() => {
        const tomorrow = new Date(`${groupDate(new Date(nowMs), timezone)}T00:00:00Z`);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        const midnight = fromZonedTime(`${tomorrow.toISOString().slice(0, 10)}T00:00:00`, timezone || Intl.DateTimeFormat().resolvedOptions().timeZone).getTime();
        const next = Math.min(midnight, getNextMissedProjectionAt(groups.flatMap(group => group.members), nowMs) ?? midnight);
        const timer = window.setTimeout(() => setNowMs(Date.now()), Math.max(0, next - Date.now()));
        return () => window.clearTimeout(timer);
    }, [groups, nowMs, timezone]);
    return { groups, setGroups, loading, error, refresh, nowMs };
}
