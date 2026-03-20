import type {
    Commitment,
    CommitmentStatus,
    CommitmentTaskLink,
    RecurrenceRuleConfig,
    Task,
} from "@/lib/types";

export type DayStatus = "passed" | "failed" | "pending" | "future";

type CommitmentTask = Pick<Task, "id" | "status" | "deadline" | "failure_cost_cents" | "recurrence_rule_id">;

type RecurrenceRuleForTarget = {
    id: string;
    failure_cost_cents: number;
    rule_config: RecurrenceRuleConfig;
    created_at: string;
    last_generated_date?: string | null;
};

type OneOffTaskForTarget = Pick<Task, "id" | "failure_cost_cents">;

const PENDING_STATUSES = new Set(["CREATED", "POSTPONED", "AWAITING_VOUCHER", "MARKED_COMPLETED"]);
const PASSING_STATUSES = new Set(["COMPLETED", "RECTIFIED"]);
const FAILING_STATUSES = new Set(["FAILED"]);

function parseDateOnlyUtc(value: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function toUtcDateOnlyString(value: string | Date): string | null {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
}

function getTodayUtcDateOnly(): string {
    return new Date().toISOString().slice(0, 10);
}

function isDateOnlyInRange(dateOnly: string, startDateOnly: string, endDateOnly: string): boolean {
    return dateOnly >= startDateOnly && dateOnly <= endDateOnly;
}

function filterTasksInWindow(
    tasks: CommitmentTask[],
    startDateOnly: string,
    endDateOnly: string
): CommitmentTask[] {
    return tasks.filter((task) => {
        const deadlineDateOnly = toUtcDateOnlyString(task.deadline);
        if (!deadlineDateOnly) return false;
        return isDateOnlyInRange(deadlineDateOnly, startDateOnly, endDateOnly);
    });
}

function dayDiffUtc(a: Date, b: Date): number {
    const aUtc = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
    const bUtc = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
    return Math.floor((bUtc - aUtc) / (24 * 60 * 60 * 1000));
}

function startOfWeekSundayUtc(date: Date): Date {
    const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    next.setUTCDate(next.getUTCDate() - next.getUTCDay());
    return next;
}

function endOfMonthDayUtc(year: number, monthZeroBased: number): number {
    return new Date(Date.UTC(year, monthZeroBased + 1, 0)).getUTCDate();
}

function resolveAnchorDateUtc(rule: RecurrenceRuleForTarget): Date | null {
    const anchorDateOnly = rule.last_generated_date || toUtcDateOnlyString(rule.created_at);
    if (!anchorDateOnly) return null;
    return parseDateOnlyUtc(anchorDateOnly);
}

function countRuleInstancesInRange(
    rule: RecurrenceRuleForTarget,
    startDateOnly: string,
    endDateOnly: string
): number {
    const startDate = parseDateOnlyUtc(startDateOnly);
    const endDate = parseDateOnlyUtc(endDateOnly);
    const anchorDate = resolveAnchorDateUtc(rule);

    if (!startDate || !endDate || !anchorDate) return 0;
    if (endDate < startDate) return 0;

    const config = rule.rule_config || ({} as RecurrenceRuleConfig);
    const frequency = String(config.frequency || "").toUpperCase();
    const interval = Math.max(1, Number(config.interval) || 1);
    const daysOfWeekRaw = Array.isArray(config.days_of_week) ? config.days_of_week : [];
    const daysOfWeek = daysOfWeekRaw
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
    const allowedWeekDays = daysOfWeek.length > 0 ? new Set(daysOfWeek) : new Set([anchorDate.getUTCDay()]);

    let count = 0;
    for (
        const cursor = new Date(startDate);
        cursor <= endDate;
        cursor.setUTCDate(cursor.getUTCDate() + 1)
    ) {
        let include = false;
        const diffDays = dayDiffUtc(anchorDate, cursor);
        if (diffDays < 0) continue;

        if (frequency === "DAILY") {
            include = diffDays % interval === 0;
        } else if (frequency === "WEEKLY" || frequency === "CUSTOM") {
            if (!allowedWeekDays.has(cursor.getUTCDay())) continue;
            const anchorWeek = startOfWeekSundayUtc(anchorDate);
            const cursorWeek = startOfWeekSundayUtc(cursor);
            const weekDiff = Math.floor(dayDiffUtc(anchorWeek, cursorWeek) / 7);
            include = weekDiff >= 0 && weekDiff % interval === 0;
        } else if (frequency === "WEEKDAYS") {
            const weekday = cursor.getUTCDay();
            if (weekday < 1 || weekday > 5) continue;
            include = diffDays % interval === 0;
        } else if (frequency === "MONTHLY") {
            const monthDiff =
                (cursor.getUTCFullYear() - anchorDate.getUTCFullYear()) * 12 +
                (cursor.getUTCMonth() - anchorDate.getUTCMonth());
            if (monthDiff < 0 || monthDiff % interval !== 0) continue;
            const anchorDay = anchorDate.getUTCDate();
            const effectiveDay = Math.min(
                anchorDay,
                endOfMonthDayUtc(cursor.getUTCFullYear(), cursor.getUTCMonth())
            );
            include = cursor.getUTCDate() === effectiveDay;
        } else if (frequency === "YEARLY") {
            const yearDiff = cursor.getUTCFullYear() - anchorDate.getUTCFullYear();
            if (yearDiff < 0 || yearDiff % interval !== 0) continue;
            include =
                cursor.getUTCMonth() === anchorDate.getUTCMonth() &&
                cursor.getUTCDate() === anchorDate.getUTCDate();
        } else {
            include = false;
        }

        if (include) count += 1;
    }

    return count;
}

export function computeDerivedStatus(
    commitment: Pick<Commitment, "status" | "start_date" | "end_date">,
    linkedTasks: CommitmentTask[]
): CommitmentStatus {
    if (commitment.status === "DRAFT") {
        return "DRAFT";
    }

    const tasksInWindow = filterTasksInWindow(linkedTasks, commitment.start_date, commitment.end_date);

    if (tasksInWindow.some((task) => FAILING_STATUSES.has(task.status))) {
        return "FAILED";
    }

    if (tasksInWindow.some((task) => PENDING_STATUSES.has(task.status))) {
        return "ACTIVE";
    }

    const todayDateOnly = getTodayUtcDateOnly();
    if (todayDateOnly > commitment.end_date) {
        return "COMPLETED";
    }

    return "ACTIVE";
}

export function computeEarnedSoFar(
    linkedTasks: CommitmentTask[],
    startDateOnly: string,
    endDateOnly: string
): number {
    const todayDateOnly = getTodayUtcDateOnly();
    const tasksInWindow = filterTasksInWindow(linkedTasks, startDateOnly, endDateOnly);

    return tasksInWindow.reduce((sum, task) => {
        const deadlineDateOnly = toUtcDateOnlyString(task.deadline);
        if (!deadlineDateOnly || deadlineDateOnly > todayDateOnly) {
            return sum;
        }
        if (!PASSING_STATUSES.has(task.status)) {
            return sum;
        }
        return sum + (Number(task.failure_cost_cents) || 0);
    }, 0);
}

export function computeTotalTarget(
    links: CommitmentTaskLink[],
    recurrenceRules: RecurrenceRuleForTarget[],
    oneOffTasks: OneOffTaskForTarget[],
    startDateOnly: string,
    endDateOnly: string
): number {
    const recurrenceRuleById = new Map(recurrenceRules.map((rule) => [rule.id, rule]));
    const taskById = new Map(oneOffTasks.map((task) => [task.id, task]));
    let total = 0;

    for (const link of links) {
        if (link.task_id) {
            const task = taskById.get(link.task_id);
            if (task) {
                total += Number(task.failure_cost_cents) || 0;
            }
            continue;
        }

        if (link.recurrence_rule_id) {
            const rule = recurrenceRuleById.get(link.recurrence_rule_id);
            if (!rule) continue;
            const instanceCount = countRuleInstancesInRange(rule, startDateOnly, endDateOnly);
            total += instanceCount * (Number(rule.failure_cost_cents) || 0);
        }
    }

    return total;
}

export function getDayStatuses(
    linkedTasks: CommitmentTask[],
    startDateOnly: string,
    endDateOnly: string
): Map<string, DayStatus> {
    const tasksInWindow = filterTasksInWindow(linkedTasks, startDateOnly, endDateOnly);
    const groupedByDate = new Map<string, CommitmentTask[]>();
    const todayDateOnly = getTodayUtcDateOnly();

    for (const task of tasksInWindow) {
        const dateOnly = toUtcDateOnlyString(task.deadline);
        if (!dateOnly) continue;
        const current = groupedByDate.get(dateOnly) || [];
        current.push(task);
        groupedByDate.set(dateOnly, current);
    }

    const entries = Array.from(groupedByDate.entries()).sort(([a], [b]) => a.localeCompare(b));
    const result = new Map<string, DayStatus>();

    for (const [dateOnly, tasks] of entries) {
        if (tasks.some((task) => FAILING_STATUSES.has(task.status))) {
            result.set(dateOnly, "failed");
            continue;
        }

        if (tasks.every((task) => PASSING_STATUSES.has(task.status))) {
            result.set(dateOnly, "passed");
            continue;
        }

        if (dateOnly > todayDateOnly) {
            result.set(dateOnly, "future");
            continue;
        }

        result.set(dateOnly, "pending");
    }

    return result;
}
