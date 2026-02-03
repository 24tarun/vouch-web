"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { TaskRow } from "./TaskRow";
import type { Task } from "@/lib/types";
import { Button } from "./ui/button";

interface CollapsibleCompletedListProps {
    tasks: Task[];
}

export function CollapsibleCompletedList({ tasks }: CollapsibleCompletedListProps) {
    const [isOpen, setIsOpen] = useState(true);

    if (tasks.length === 0) return null;

    return (
        <div className="mt-8">
            <Button
                variant="ghost"
                onClick={() => setIsOpen(!isOpen)}
                className="group flex items-center gap-2 text-slate-500 hover:text-slate-300 px-0 hover:bg-transparent"
            >
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <span className="font-medium text-sm">Completed ({tasks.length})</span>
            </Button>

            {isOpen && (
                <div className="mt-2 pl-4 border-l border-slate-800/50 ml-2">
                    <div className="flex flex-col">
                        {tasks.map((task) => (
                            <TaskRow key={task.id} task={task} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
