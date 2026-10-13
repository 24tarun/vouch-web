interface TaskRowData { id: string; deadline: string; created_at?: string; updated_at?: string }

export type DashboardSortMode =
  | 'deadline_asc'
  | 'deadline_desc'
  | 'created_asc'
  | 'created_desc';

function safeTimestamp(value: string): number {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function sortDashboardTasks<T extends TaskRowData>(tasks: T[], sortMode: DashboardSortMode): T[] {
  return [...tasks].sort((a, b) => {
    const deadlineA = safeTimestamp(a.deadline);
    const deadlineB = safeTimestamp(b.deadline);
    const createdA = safeTimestamp(a.created_at ?? '');
    const createdB = safeTimestamp(b.created_at ?? '');

    if (sortMode === 'deadline_asc') {
      if (deadlineA !== deadlineB) return deadlineA - deadlineB;
      if (createdA !== createdB) return createdB - createdA;
      return a.id.localeCompare(b.id);
    }

    if (sortMode === 'deadline_desc') {
      if (deadlineA !== deadlineB) return deadlineB - deadlineA;
      if (createdA !== createdB) return createdB - createdA;
      return a.id.localeCompare(b.id);
    }

    if (sortMode === 'created_asc') {
      if (createdA !== createdB) return createdA - createdB;
      if (deadlineA !== deadlineB) return deadlineA - deadlineB;
      return a.id.localeCompare(b.id);
    }

    if (createdA !== createdB) return createdB - createdA;
    if (deadlineA !== deadlineB) return deadlineA - deadlineB;
    return a.id.localeCompare(b.id);
  });
}

export function sortPastTasksLatest<T extends TaskRowData>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const updatedA = safeTimestamp(a.updated_at ?? '');
    const updatedB = safeTimestamp(b.updated_at ?? '');
    if (updatedA !== updatedB) return updatedB - updatedA;
    return a.id.localeCompare(b.id);
  });
}
