import type { Task as TaskRowData } from '@/lib/types';
import type { Commitment, CommitmentTaskLink } from '@/lib/types';
import { getEffectiveTaskStatus } from '@/lib/groups/effective-status';
import {
  sortDashboardTasks,
  sortPastTasksLatest,
  type DashboardSortMode,
} from '@/lib/groups/sort';

const GROUP_PENDING = new Set([
  'ACTIVE',
  'POSTPONED',
  'MARKED_COMPLETE',
  'AWAITING_VOUCHER',
  'AWAITING_AI',
  'AWAITING_USER',
  'ESCALATED',
  'AI_DENIED',
]);
const GROUP_FAILING = new Set([
  'DENIED',
  'MISSED',
  'SURRENDERED',
  'AWAITING_RECTIFICATION',
]);
export type GroupDaySummary = 'pending' | 'failed' | 'completed';
export interface ResolvedGroup extends Commitment {
  links: CommitmentTaskLink[];
  members: TaskRowData[];
}
export type DashboardEntry =
  | { kind: 'task'; key: string; task: TaskRowData }
  | {
      kind: 'group-empty';
      key: string;
      groupId: string;
      title: string;
      deadline: '';
      created_at: string;
      bucket: 'dueSoon';
    }
  | {
      kind: 'group';
      key: string;
      groupId: string;
      title: string;
      deadline: string;
      created_at: string;
      bucket: 'dueSoon' | 'future';
      representative: TaskRowData;
    }
  | {
      kind: 'group-history';
      key: string;
      groupId: string;
      title: string;
      date: string;
      deadline: string;
      updated_at: string;
      summary: GroupDaySummary;
    };

export function groupDate(
  value: string | Date,
  timezone?: string | null,
): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)?.value)
    .join('-');
}

export function belongsToGroup(
  task: TaskRowData,
  group: ResolvedGroup,
): boolean {
  return (
    task.status !== 'DELETED' &&
    group.links.some(
      (link) =>
        link.task_id === task.id ||
        Boolean(
          link.recurrence_rule_id &&
            link.recurrence_rule_id === task.recurrence_rule_id,
        ),
    )
  );
}

export function isGroupActionable(
  task: TaskRowData,
  nowMs = Date.now(),
): boolean {
  const status = getEffectiveTaskStatus(task, nowMs);
  return status === 'ACTIVE' || status === 'POSTPONED';
}

function summarizeGroupDay(
  tasks: TaskRowData[],
  nowMs = Date.now(),
): GroupDaySummary {
  if (
    tasks.some((task) =>
      GROUP_PENDING.has(getEffectiveTaskStatus(task, nowMs) ?? ''),
    )
  )
    return 'pending';
  if (
    tasks.some((task) =>
      GROUP_FAILING.has(getEffectiveTaskStatus(task, nowMs) ?? ''),
    )
  )
    return 'failed';
  return 'completed';
}

// Complete group member data supplies summaries; raw task pages only decide which
// historical dates have been reached. Never compute a summary from a partial page.
export function buildGroupDashboard({
  groups,
  dueSoonTasks,
  futureTasks,
  pastTasks,
  timezone,
  sortMode,
  futureBoundaryMs,
  nowMs = Date.now(),
}: {
  groups: ResolvedGroup[];
  dueSoonTasks: TaskRowData[];
  futureTasks: TaskRowData[];
  pastTasks: TaskRowData[];
  timezone?: string | null;
  sortMode: DashboardSortMode;
  futureBoundaryMs: number;
  nowMs?: number;
}) {
  const canonical = new Map(
    [...dueSoonTasks, ...futureTasks, ...pastTasks].map((task) => [
      task.id,
      task,
    ]),
  );
  const hidden = new Set<string>();
  const live: DashboardEntry[] = [];
  const history: DashboardEntry[] = [];
  const today = groupDate(new Date(nowMs), timezone);
  for (const group of groups) {
    const all = new Map(group.members.map((task) => [task.id, task]));
    // Canonical optimistic task caches take precedence over fetched group members.
    for (const task of canonical.values())
      if (all.has(task.id) || belongsToGroup(task, group))
        all.set(task.id, { ...all.get(task.id), ...task });
    const members = [...all.values()].filter((task) =>
      belongsToGroup(task, group),
    );
    if (!members.length) {
      live.push({
        kind: 'group-empty',
        key: `group:${group.id}`,
        groupId: group.id,
        title: group.name,
        deadline: '',
        created_at: group.created_at,
        bucket: 'dueSoon',
      });
      continue;
    }
    members.forEach((task) => hidden.add(task.id));
    const actionable = sortDashboardTasks(
      members.filter((task) => isGroupActionable(task, nowMs)),
      'deadline_asc',
    );
    const representative = actionable[0];
    if (representative)
      live.push({
        kind: 'group',
        key: `group:${group.id}`,
        groupId: group.id,
        title: group.name,
        deadline: representative.deadline,
        created_at: group.created_at,
        bucket:
          Date.parse(representative.deadline) < futureBoundaryMs
            ? 'dueSoon'
            : 'future',
        representative,
      });
    const dates = new Set(
      pastTasks
        .filter((task) => members.some((member) => member.id === task.id))
        .map((task) => groupDate(task.deadline, timezone)),
    );
    if (
      members.some(
        (task) =>
          groupDate(task.deadline, timezone) === today &&
          !isGroupActionable(task, nowMs),
      )
    )
      dates.add(today);
    // Locally projected misses may not have reached the raw history page yet.
    members
      .filter(
        (task) =>
          (task.status === 'ACTIVE' || task.status === 'POSTPONED') &&
          !isGroupActionable(task, nowMs),
      )
      .forEach((task) => dates.add(groupDate(task.deadline, timezone)));
    for (const date of dates) {
      const day = members.filter(
        (task) => groupDate(task.deadline, timezone) === date,
      );
      if (!day.length || day.some((task) => isGroupActionable(task, nowMs)))
        continue;
      const latest = sortPastTasksLatest(day)[0];
      history.push({
        kind: 'group-history',
        key: `group-history:${group.id}:${date}`,
        groupId: group.id,
        title: group.name,
        date,
        deadline: latest.deadline,
        updated_at: latest.updated_at ?? latest.created_at ?? latest.deadline,
        summary: summarizeGroupDay(day, nowMs),
      });
    }
  }
  const wrap = (task: TaskRowData): DashboardEntry => ({
    kind: 'task',
    key: `task:${task.id}`,
    task,
  });
  const sortLive = (entries: DashboardEntry[]) => {
    const rows = entries.map((entry) =>
      entry.kind === 'task'
        ? { ...entry.task, id: entry.key }
        : {
            id: entry.key,
            title: entry.title,
            deadline: entry.deadline,
            created_at:
              entry.kind === 'group' || entry.kind === 'group-empty'
                ? entry.created_at
                : undefined,
          },
    );
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));
    const sorted = sortDashboardTasks(rows, sortMode).map(
      (row) => byKey.get(row.id)!,
    );
    // Empty groups have no actionable deadline. Keep dated work first for deadline sorting.
    return sortMode.startsWith('deadline')
      ? [
          ...sorted.filter((entry) => entry.kind !== 'group-empty'),
          ...sorted.filter((entry) => entry.kind === 'group-empty'),
        ]
      : sorted;
  };
  const pastEntries = [
    ...pastTasks.filter((task) => !hidden.has(task.id)).map(wrap),
    ...history,
  ];
  const byKey = new Map(pastEntries.map((entry) => [entry.key, entry]));
  return {
    dueSoon: sortLive([
      ...dueSoonTasks.filter((task) => !hidden.has(task.id)).map(wrap),
      ...live.filter(
        (entry) =>
          (entry.kind === 'group' || entry.kind === 'group-empty') &&
          entry.bucket === 'dueSoon',
      ),
    ]),
    future: sortLive([
      ...futureTasks.filter((task) => !hidden.has(task.id)).map(wrap),
      ...live.filter(
        (entry) => entry.kind === 'group' && entry.bucket === 'future',
      ),
    ]),
    past: sortPastTasksLatest(
      pastEntries.map((entry) =>
        entry.kind === 'task'
          ? { ...entry.task, id: entry.key }
          : {
              id: entry.key,
              title: entry.title,
              deadline: entry.deadline,
              updated_at:
                entry.kind === 'group-history' ? entry.updated_at : undefined,
            },
      ),
    ).map((row) => byKey.get(row.id)!),
  };
}
