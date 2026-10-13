import { notFound } from 'next/navigation';
import { getGroups } from '@/actions/groups';
import { getCachedActiveTasksForUser } from '@/actions/tasks';
import { GroupDetailClient } from '@/components/groups/GroupDetailClient';
export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const groups = await getGroups();
    const group = groups.find(group => group.id === id);
    if (!group) notFound();
    const candidates = await getCachedActiveTasksForUser(group.user_id);
    return <GroupDetailClient group={group} candidates={candidates} />;
}
