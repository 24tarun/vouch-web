"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { TaskRow } from "./TaskRow";
import type { Task } from "@/lib/types";
import { Button } from "./ui/button";
import { useCollapsibleSection } from "@/lib/ui/useCollapsibleSection";

interface CollapsibleCompletedListProps {
    tasks: Task[];
}

export function CollapsibleCompletedList({ tasks }: CollapsibleCompletedListProps) {
    const [isOpen, toggle] = useCollapsibleSection("dashboard.completed.open");

    if (tasks.length === 0) return null;

    return (
        <div className="mt-8">
            <Button
                variant="ghost"
                onClick={toggle}
                className="group flex items-center gap-2 text-slate-400 hover:text-white px-0 hover:bg-transparent"
                aria-expanded={isOpen}
            >
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <span className="font-medium text-sm">Past</span>
            </Button>

            {isOpen && (
                <div className="mt-2">
                    <div className="flex flex-col">
                        {tasks.map((task) => (
                            <TaskRow key={task.id} task={task} layoutVariant="completed" />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
