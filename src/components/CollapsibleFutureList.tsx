"use client";

import { type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { useCollapsibleSection } from "@/lib/ui/useCollapsibleSection";

interface CollapsibleFutureListProps<T> {
    tasks: T[];
    renderTask: (task: T) => ReactNode;
}

export function CollapsibleFutureList<T>({ tasks, renderTask }: CollapsibleFutureListProps<T>) {
    const [isOpen, toggle] = useCollapsibleSection("dashboard.future.open");

    if (tasks.length === 0) return null;

    return (
        <div className="mt-8" data-testid="future-accordion">
            <Button
                variant="ghost"
                onClick={toggle}
                className="group -ml-2.5 md:ml-0 flex items-center gap-2 text-slate-400 hover:text-white px-0 hover:bg-transparent"
                aria-expanded={isOpen}
                aria-controls="dashboard-future-tasks-panel"
            >
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <span className="font-medium text-sm">Future</span>
            </Button>

            {isOpen && (
                <div className="mt-2" id="dashboard-future-tasks-panel">
                    <div className="flex flex-col">
                        {tasks.map((task) => renderTask(task))}
                    </div>
                </div>
            )}
        </div>
    );
}
