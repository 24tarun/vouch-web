"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { TaskWithRelations } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { CompactStatsItem } from "@/components/CompactStatsItem";

type StatsTask = TaskWithRelations & { pomo_total_seconds?: number };

const HISTORY_PAGE_SIZE = 10;
const STATS_HISTORY_OPEN_SESSION_KEY = "stats.history.open";

interface StatsHistoryTaskListProps {
    tasks: StatsTask[];
}

export function StatsHistoryTaskList({ tasks }: StatsHistoryTaskListProps) {
    const [isOpen, setIsOpen] = useState<boolean>(() => {
        if (typeof window === "undefined") return false;
        return window.sessionStorage.getItem(STATS_HISTORY_OPEN_SESSION_KEY) === "1";
    });
    const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE);

    const handleToggle = () => {
        setIsOpen((prev) => {
            const next = !prev;
            if (typeof window !== "undefined") {
                if (next) {
                    window.sessionStorage.setItem(STATS_HISTORY_OPEN_SESSION_KEY, "1");
                } else {
                    window.sessionStorage.removeItem(STATS_HISTORY_OPEN_SESSION_KEY);
                }
            }
            return next;
        });
    };

    const visibleTasks = tasks.slice(0, visibleCount);
    const hasMore = visibleCount < tasks.length;

    return (
        <section className="space-y-4">
            <Button
                variant="ghost"
                onClick={handleToggle}
                className="group flex items-center gap-2 text-slate-400 hover:text-white px-0 hover:bg-transparent"
            >
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <span className="font-medium text-sm">Task History</span>
            </Button>

            {isOpen && (
                <div className="flex flex-col border-t border-slate-900/50">
                    {tasks.length === 0 ? (
                        <div className="py-8 text-center">
                            <p className="text-slate-600 text-sm">No history yet</p>
                        </div>
                    ) : (
                        <>
                            {visibleTasks.map((task) => (
                                <CompactStatsItem key={task.id} task={task} />
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
            )}
        </section>
    );
}
