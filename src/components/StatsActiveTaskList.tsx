"use client";

import { useMemo } from "react";
import type { TaskWithRelations } from "@/lib/types";
import { CompactStatsItem } from "@/components/CompactStatsItem";
import { TaskDetailPrefetcher } from "@/components/TaskDetailPrefetcher";

type StatsTask = TaskWithRelations & { pomo_total_seconds?: number };
const ACTIVE_SECTION_STATUSES = new Set([
    "ACTIVE",
    "POSTPONED",
    "MARKED_COMPLETE",
    "AWAITING_VOUCHER",
    "AWAITING_AI",
    "AWAITING_USER",
    "ESCALATED",
]);

interface StatsActiveTaskListProps {
    initialTasks: StatsTask[];
}

export function StatsActiveTaskList({
    initialTasks,
}: StatsActiveTaskListProps) {
    const tasks = useMemo(
        () => initialTasks.filter((task) => ACTIVE_SECTION_STATUSES.has(task.status)),
        [initialTasks]
    );

    return (
        <>
            <TaskDetailPrefetcher tasks={tasks} />
            {tasks.map((task) => (
                <CompactStatsItem
                    key={task.id}
                    task={task}
                    forceActiveBadge
                    onRowClick={() => {}}
                />
            ))}
        </>
    );
}
