"use client";

import { useState } from "react";
import type { TaskWithRelations } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { CompactStatsItem } from "@/components/CompactStatsItem";

type StatsTask = TaskWithRelations & { pomo_total_seconds?: number };

const HISTORY_PAGE_SIZE = 20;

interface StatsHistoryTaskListProps {
    tasks: StatsTask[];
}

export function StatsHistoryTaskList({ tasks }: StatsHistoryTaskListProps) {
    const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE);

    const visibleTasks = tasks.slice(0, visibleCount);
    const hasMore = visibleCount < tasks.length;

    return (
        <section className="space-y-4">
            <h2 className="font-medium text-sm text-slate-400">Task History</h2>

            <div className="flex flex-col border-t border-slate-900/50">
                {tasks.length === 0 ? (
                    <div className="py-8 text-center">
                        <p className="text-slate-600 text-sm">No history yet</p>
                    </div>
                ) : (
                    <>
                        {visibleTasks.map((task) => (
                            <CompactStatsItem key={task.id} task={task} onRowClick={() => {}} />
                        ))}

                        {hasMore && (
                            <div className="pt-4 flex justify-center">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setVisibleCount((prev) => prev + HISTORY_PAGE_SIZE)}
                                    className="border-slate-800 bg-slate-900/50 text-slate-300 hover:text-white"
                                >
                                    Load more
                                </Button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </section>
    );
}
