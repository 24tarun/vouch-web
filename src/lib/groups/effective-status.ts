import type { TaskStatus } from '@/lib/xstate/task-machine';

const DEADLINE_MISSED_PROJECTION_DELAY_MS = 60_000;

interface DeadlineStatusTask {
  status?: string | null;
  deadline?: string | null;
}

export function getEffectiveTaskStatus(
  task: DeadlineStatusTask,
  nowMs: number = Date.now(),
): string | null | undefined {
  if (task.status !== 'ACTIVE' && task.status !== 'POSTPONED') return task.status;
  const deadlineMs = task.deadline ? Date.parse(task.deadline) : NaN;
  if (!Number.isFinite(deadlineMs)) return task.status;
  return nowMs >= deadlineMs + DEADLINE_MISSED_PROJECTION_DELAY_MS
    ? ('MISSED' satisfies TaskStatus)
    : task.status;
}

export function getNextMissedProjectionAt(
  tasks: DeadlineStatusTask[],
  nowMs: number = Date.now(),
): number | null {
  let next: number | null = null;
  for (const task of tasks) {
    if (task.status !== 'ACTIVE' && task.status !== 'POSTPONED') continue;
    const deadlineMs = task.deadline ? Date.parse(task.deadline) : NaN;
    if (!Number.isFinite(deadlineMs)) continue;
    const cutoff = deadlineMs + DEADLINE_MISSED_PROJECTION_DELAY_MS;
    if (cutoff <= nowMs) continue;
    if (next === null || cutoff < next) next = cutoff;
  }
  return next;
}

