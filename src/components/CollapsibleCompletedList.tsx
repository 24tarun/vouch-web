"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { TaskRow } from "./TaskRow";
import type { Task } from "@/lib/types";
import { Button } from "./ui/button";

interface CollapsibleCompletedListProps {
    tasks: Task[];
}

const DASHBOARD_COMPLETED_OPEN_SESSION_KEY = "dashboard.completed.open";

export function CollapsibleCompletedList({ tasks }: CollapsibleCompletedListProps) {
    const [isOpen, setIsOpen] = useState<boolean>(() => {
        if (typeof window === "undefined") return false;
        try {
            return window.sessionStorage.getItem(DASHBOARD_COMPLETED_OPEN_SESSION_KEY) === "1";
        } catch {
            return false;
        }
    });

    if (tasks.length === 0) return null;

    const handleToggle = () => {
        setIsOpen((prev) => {
            const next = !prev;
            if (typeof window !== "undefined") {
                try {
                    if (next) {
                        window.sessionStorage.setItem(DASHBOARD_COMPLETED_OPEN_SESSION_KEY, "1");
                    } else {
                        window.sessionStorage.removeItem(DASHBOARD_COMPLETED_OPEN_SESSION_KEY);
                    }
                } catch {
                    // Ignore sessionStorage write failures.
                }
            }
            return next;
        });
    };

    return (
        <div className="mt-8">
            <Button
                variant="ghost"
                onClick={handleToggle}
                className="group flex items-center gap-2 text-slate-400 hover:text-white px-0 hover:bg-transparent"
            >
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <span className="font-medium text-sm">Past</span>
            </Button>

            {isOpen && (
                <div className="mt-2 pl-4 border-l border-slate-800/50 ml-2">
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
